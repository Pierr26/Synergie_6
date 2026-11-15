<?php

namespace App\Services\Reports;

use App\Services\Lab\LabResultService;
use App\Services\Workspace\WorkspaceClock;
use App\Support\CanonicalJson;
use App\Support\MongoJson;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;

/**
 * Individual report snapshots (M11, cahier des charges p.7).
 *
 * "Generate report" freezes, for one crew member and one period (7 days
 * including today by default), every reading with its unit, method and
 * quality, the absences, the lab results collected in the period and
 * available now, reviews, follow-ups and the rule versions used. A later
 * correction never changes an existing snapshot. The payload matches the
 * ground receiver contract (PUT /api/v1/reports/{reportId}).
 */
final class ReportBuilder
{
    private const array TypeMap = ['root' => 'array', 'document' => 'array', 'array' => 'array'];

    public const string EmptyPeriodNotice = 'No observations in this period';

    public function __construct(
        private readonly WorkspaceClock $clock,
        private readonly LabResultService $labs,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function generate(string $workspaceId, string $subjectId, string $authorId, ?int $fromDay = null, ?int $toDay = null): array
    {
        $today = $this->clock->missionDay($workspaceId);
        $toDay ??= $today;
        $fromDay ??= $toDay - 6;

        if ($fromDay > $toDay || $toDay > $today) {
            throw new ReportException('The period must end today or earlier and start before it ends.');
        }

        $workspace = $this->clock->workspace($workspaceId);
        $subject = $this->member($workspaceId, $subjectId);
        $author = $this->member($workspaceId, $authorId);
        $from = $this->clock->dayStart($workspaceId, $fromDay);
        $to = $this->clock->dayStart($workspaceId, $toDay + 1)->subSecond();
        $generatedAt = $this->clock->now($workspaceId);
        $reportId = (string) Str::uuid();

        $observations = $this->observations($workspaceId, $subjectId, $fromDay, $toDay);
        $notes = array_filter([
            ($workspace['dataLabel'] ?? null) ?: null,
            $observations === [] ? self::EmptyPeriodNotice : null,
        ]);

        $payload = MongoJson::normalize([
            'reportId' => $reportId,
            'schemaVersion' => 1,
            'workspaceId' => $workspaceId,
            'missionId' => $workspace['missionId'],
            'simulated' => (bool) ($subject['simulated'] ?? true),
            'subject' => ['crewId' => $subjectId, 'alias' => $subject['alias']],
            'author' => ['crewId' => $authorId, 'alias' => $author['alias'], 'role' => $author['role']],
            'period' => ['from' => $from->format('Y-m-d\TH:i:s\Z'), 'to' => $to->format('Y-m-d\TH:i:s\Z')],
            'generatedAt' => $generatedAt->format('Y-m-d\TH:i:s\Z'),
            'missionDay' => $today,
            'timezone' => 'UTC',
            'observations' => $observations,
            'absences' => $this->absences($workspaceId, $subjectId, $fromDay, $toDay),
            'labResults' => $this->labResults($workspaceId, $subjectId, $from, $to),
            'reviews' => $this->reviews($workspaceId, $subjectId, $fromDay, $toDay, $from, $to),
            'followUps' => $this->followUps($workspaceId, $subjectId, $from, $to),
            'rules' => $this->rules($workspace),
            'notes' => implode('. ', $notes) ?: null,
        ]);

        $this->collection()->insertOne([
            '_id' => $reportId,
            'workspaceId' => $workspaceId,
            'subjectId' => $subjectId,
            'authorId' => $authorId,
            'period' => ['fromDay' => $fromDay, 'toDay' => $toDay],
            'payload' => $payload,
            'sha256' => CanonicalJson::sha256($payload),
            'generatedAt' => new UTCDateTime($generatedAt),
            'delivery' => ['state' => 'local', 'receiver' => null, 'attempts' => [], 'receipt' => null],
        ]);

        return $this->find($workspaceId, $reportId);
    }

    /**
     * @return array<string, mixed>
     */
    public function find(string $workspaceId, string $reportId): array
    {
        $report = $this->collection()->findOne(['_id' => $reportId, 'workspaceId' => $workspaceId], ['typeMap' => self::TypeMap]);

        abort_if($report === null, 404, 'Report not found in this workspace.');

        return $report;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function forSubject(string $workspaceId, string $subjectId): array
    {
        return iterator_to_array($this->collection()->find(
            ['workspaceId' => $workspaceId, 'subjectId' => $subjectId],
            ['sort' => ['generatedAt' => -1, '_id' => 1], 'projection' => ['payload.observations' => 0], 'typeMap' => self::TypeMap],
        ), false);
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function observations(string $workspaceId, string $subjectId, int $fromDay, int $toDay): array
    {
        $cursor = DB::connection('mongodb')->getCollection('observations')->find(
            ['workspaceId' => $workspaceId, 'subjectId' => $subjectId, 'status' => 'current', 'missionDay' => ['$gte' => $fromDay, '$lte' => $toDay]],
            ['sort' => ['missionDay' => 1, 'variable' => 1, '_id' => 1], 'typeMap' => self::TypeMap],
        );

        return array_map(fn (array $observation): array => [
            'id' => $observation['_id'],
            'variable' => $observation['variable'],
            'missionDay' => $observation['missionDay'],
            'value' => $observation['value'],
            'unit' => $observation['unit'] ?? null,
            'method' => $observation['method'],
            'device' => $observation['device'] ?? null,
            'context' => $observation['context'] ?? [],
            'quality' => $observation['quality'],
            'qualityFlags' => $observation['qualityFlags'] ?? [],
            'seriesKey' => $observation['seriesKey'] ?? null,
            'source' => $observation['source'] ?? null,
            'observedAt' => $observation['observedAt'],
            'version' => $observation['version'],
        ], iterator_to_array($cursor, false));
    }

    /**
     * @return list<array{missionDay: int, field: string, reason: string}>
     */
    private function absences(string $workspaceId, string $subjectId, int $fromDay, int $toDay): array
    {
        $checkins = [];

        foreach (DB::connection('mongodb')->getCollection('checkins')->find(
            ['workspaceId' => $workspaceId, 'subjectId' => $subjectId, 'status' => 'submitted', 'missionDay' => ['$gte' => $fromDay, '$lte' => $toDay]],
            ['typeMap' => self::TypeMap],
        ) as $checkin) {
            $checkins[$checkin['missionDay']] = $checkin;
        }

        $absences = [];

        for ($day = $fromDay; $day <= $toDay; $day++) {
            if (! isset($checkins[$day])) {
                $absences[] = ['missionDay' => $day, 'field' => 'daily_checkin', 'reason' => 'no_submission'];

                continue;
            }

            foreach ($checkins[$day]['unavailableFields'] ?? [] as $field) {
                $absences[] = ['missionDay' => $day, 'field' => $field, 'reason' => 'not_recorded'];
            }
        }

        return $absences;
    }

    /**
     * Results collected in the period and available at generation time,
     * even if issued later. Results without collection time stay out.
     *
     * @return list<array<string, mixed>>
     */
    private function labResults(string $workspaceId, string $subjectId, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $results = array_filter($this->labs->list($workspaceId, $subjectId), function (array $result) use ($from, $to): bool {
            if (! $result['reportable']) {
                return false;
            }

            $collectedAt = CarbonImmutable::instance($result['collectedAt']->toDateTime());

            return $collectedAt->betweenIncluded($from, $to);
        });

        return array_values(array_map(fn (array $result): array => [
            'id' => $result['_id'],
            'analyte' => $result['analyte'],
            'loinc' => $result['loinc'],
            'value' => $result['value'],
            'unit' => $result['unit'],
            'specimen' => $result['specimen'] ?? null,
            'method' => $result['method'] ?? null,
            'laboratory' => $result['laboratory'] ?? null,
            'collectedAt' => $result['collectedAt'],
            'analyzedAt' => $result['analyzedAt'] ?? null,
            'issuedAt' => $result['issuedAt'] ?? null,
            'status' => $result['status'],
            'verified' => $result['verified'] ?? false,
            'labFlag' => $result['labFlag'] ?? null,
            'version' => $result['version'],
            'evaluation' => $result['evaluation'],
            'processingDelayMinutes' => $result['processingDelayMinutes'],
        ], $results));
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function reviews(string $workspaceId, string $subjectId, int $fromDay, int $toDay, CarbonImmutable $from, CarbonImmutable $to): array
    {
        $reviews = [];

        foreach (DB::connection('mongodb')->getCollection('alerts')->find(
            ['workspaceId' => $workspaceId, 'subjectId' => $subjectId, 'startDay' => ['$lte' => $toDay], 'lastDay' => ['$gte' => $fromDay]],
            ['sort' => ['startDay' => 1], 'typeMap' => self::TypeMap],
        ) as $alert) {
            $reviews[] = [
                'type' => 'rule_alert',
                'id' => $alert['_id'],
                'rule' => $alert['rule'],
                'ruleVersion' => $alert['ruleVersion'],
                'label' => $alert['label'],
                'status' => $alert['status'],
                'evidence' => $alert['evidence'],
                'reviews' => $alert['reviews'],
            ];
        }

        foreach (DB::connection('mongodb')->getCollection('analyses')->find(
            ['workspaceId' => $workspaceId, 'subjectId' => $subjectId, 'status' => 'completed', 'createdAt' => ['$gte' => new UTCDateTime($from), '$lte' => new UTCDateTime($to)]],
            ['sort' => ['createdAt' => 1], 'typeMap' => self::TypeMap],
        ) as $analysis) {
            $reviews[] = [
                'type' => 'vision_analysis',
                'id' => $analysis['_id'],
                'kind' => $analysis['kind'],
                'summary' => $analysis['assessment']['summary'] ?? null,
                'escalation' => $analysis['escalation'] ?? null,
                'model' => $analysis['model']['id'] ?? null,
                'disclaimer' => $analysis['disclaimer'],
                'createdAt' => $analysis['createdAt'],
            ];
        }

        return $reviews;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function followUps(string $workspaceId, string $subjectId, CarbonImmutable $from, CarbonImmutable $to): array
    {
        return iterator_to_array(DB::connection('mongodb')->getCollection('follow_ups')->find(
            ['workspaceId' => $workspaceId, 'subjectId' => $subjectId, 'createdAt' => ['$gte' => new UTCDateTime($from), '$lte' => new UTCDateTime($to)]],
            ['sort' => ['createdAt' => 1], 'projection' => ['workspaceId' => 0], 'typeMap' => self::TypeMap],
        ), false);
    }

    /**
     * @param  array<string, mixed>  $workspace
     * @return list<array<string, mixed>>
     */
    private function rules(array $workspace): array
    {
        $rule = $workspace['policy']['sleepRule'] ?? null;

        return $rule === null
            ? [['id' => null, 'message' => $workspace['policy']['sleepRuleMessage'] ?? 'No mission rule configured']]
            : [['id' => $rule['id'], 'version' => $rule['version'], 'label' => $rule['label']]];
    }

    /**
     * @return array<string, mixed>
     */
    private function member(string $workspaceId, string $crewId): array
    {
        return DB::connection('mongodb')->getCollection('crew_members')->findOne(['workspaceId' => $workspaceId, 'crewId' => $crewId], ['typeMap' => self::TypeMap]);
    }

    private function collection(): Collection
    {
        return DB::connection('mongodb')->getCollection('report_snapshots');
    }
}
