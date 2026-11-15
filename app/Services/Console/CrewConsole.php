<?php

namespace App\Services\Console;

use App\Services\Agent\HealthAnalysisService;
use App\Services\FollowUps\FollowUpService;
use App\Services\Lab\LabResultService;
use App\Services\Rules\SleepAlertService;
use App\Services\Rules\SleepRule;
use App\Services\Workspace\WorkspaceClock;
use Illuminate\Support\Facades\DB;
use MongoDB\Collection;

/**
 * Crew Medical Console (M09, cahier des charges p.7 et p.19).
 *
 * The list replaces the mockup's global score by explicit, motivated states.
 * The crew file gathers trends with visible gaps, the personal reference,
 * lab results, missing observations, alerts, follow-ups and analyses.
 */
final class CrewConsole
{
    private const array TypeMap = ['root' => 'array', 'document' => 'array', 'array' => 'array'];

    /** Daily check-in variables shown as trends. */
    public const array TrendVariables = [
        'sleep_duration', 'actigraphy_sleep_duration', 'sleepiness', 'mood', 'fatigue', 'stress', 'perceived_isolation', 'perceived_workload', 'resting_heart_rate',
    ];

    /** On-demand measurements shown as latest value per series. */
    public const array SpotVariables = ['blood_pressure', 'spo2', 'temperature', 'cabin_co2', 'cabin_temperature', 'glucose', 'heart_rate', 'respiratory_rate', 'radiation_dose_rate', 'radiation_absorbed_dose', 'urine_color', 'skin_observation'];

    public function __construct(
        private readonly WorkspaceClock $clock,
        private readonly SleepRule $sleepRule,
        private readonly SleepAlertService $alerts,
        private readonly FollowUpService $followUps,
        private readonly LabResultService $labs,
        private readonly HealthAnalysisService $analyses,
    ) {}

    /**
     * @return array{clock: array<string, mixed>, crew: list<array<string, mixed>>}
     */
    public function overview(string $workspaceId): array
    {
        $today = $this->clock->missionDay($workspaceId);
        $crew = [];

        foreach ($this->collection('crew_members')->find(['workspaceId' => $workspaceId, 'role' => 'astronaut'], ['sort' => ['crewId' => 1], 'typeMap' => self::TypeMap]) as $member) {
            $crewId = $member['crewId'];
            $lastCheckin = $this->collection('checkins')->findOne(
                ['workspaceId' => $workspaceId, 'subjectId' => $crewId, 'status' => 'submitted'],
                ['sort' => ['missionDay' => -1], 'typeMap' => self::TypeMap],
            );
            $openAlerts = $this->collection('alerts')->countDocuments(['workspaceId' => $workspaceId, 'subjectId' => $crewId, 'status' => 'needs_review']);
            $openFollowUps = $this->collection('follow_ups')->countDocuments(['workspaceId' => $workspaceId, 'subjectId' => $crewId, 'status' => ['$in' => ['open', 'answered']]]);
            $pendingLabs = count(array_filter($this->labs->list($workspaceId, $crewId), fn (array $result): bool => $result['reviewFlags'] !== []));

            $reasons = array_values(array_filter([
                $openAlerts > 0 ? "{$openAlerts} alert(s) need review" : null,
                $openFollowUps > 0 ? "{$openFollowUps} follow-up(s) open" : null,
                ($lastCheckin['missionDay'] ?? null) !== $today ? "No check-in saved for day {$today}" : null,
                ($lastCheckin['unavailableFields'] ?? []) !== [] && ($lastCheckin['missionDay'] ?? null) === $today
                    ? 'Not recorded today: '.implode(', ', $lastCheckin['unavailableFields']) : null,
                $pendingLabs > 0 ? "{$pendingLabs} lab result(s) to verify" : null,
            ]));

            $crew[] = [
                'crewId' => $crewId,
                'alias' => $member['alias'],
                'position' => $member['position'] ?? null,
                'lastCheckin' => $lastCheckin === null ? null : [
                    'missionDay' => $lastCheckin['missionDay'],
                    'submittedAt' => $lastCheckin['submittedAt'],
                ],
                'state' => match (true) {
                    $openAlerts > 0 => 'needs_review',
                    $reasons !== [] => 'check',
                    default => 'no_open_item',
                },
                'reasons' => $reasons,
                'counts' => ['openAlerts' => $openAlerts, 'openFollowUps' => $openFollowUps, 'labsToVerify' => $pendingLabs],
            ];
        }

        return ['clock' => $this->clock->describe($workspaceId), 'crew' => $crew];
    }

    /**
     * @return array<string, mixed>
     */
    public function crewFile(string $workspaceId, string $crewId, int $days = 14): array
    {
        $today = $this->clock->missionDay($workspaceId);
        $fromDay = $today - $days + 1;
        $workspace = $this->clock->workspace($workspaceId);
        $member = $this->collection('crew_members')->findOne(['workspaceId' => $workspaceId, 'crewId' => $crewId], ['typeMap' => self::TypeMap]);

        return [
            'member' => ['crewId' => $crewId, 'alias' => $member['alias'], 'position' => $member['position'] ?? null, 'simulated' => $member['simulated'] ?? true],
            'clock' => $this->clock->describe($workspaceId),
            'dataLabel' => $workspace['dataLabel'] ?? null,
            'trends' => $this->trends($workspaceId, $crewId, $fromDay, $today),
            'sleepReference' => $this->sleepReference($workspaceId, $crewId, $workspace),
            'latestMeasurements' => $this->latestMeasurements($workspaceId, $crewId),
            'missing' => $this->missing($workspaceId, $crewId, $today),
            'labResults' => $this->labs->list($workspaceId, $crewId),
            'alerts' => $this->alerts->forSubject($workspaceId, $crewId),
            'followUps' => $this->followUps->list($workspaceId, ['crewId' => $crewId]),
            'analyses' => array_slice($this->analyses->forSubject($workspaceId, $crewId), 0, 10),
        ];
    }

    /**
     * One point per mission day; a day without a reading is an explicit gap.
     *
     * @return array<string, array{unit: ?string, method: ?string, points: list<array{missionDay: int, value: mixed, quality: string, observationId: ?string}>}>
     */
    private function trends(string $workspaceId, string $crewId, int $fromDay, int $toDay): array
    {
        $cursor = $this->collection('observations')->find([
            'workspaceId' => $workspaceId, 'subjectId' => $crewId, 'status' => 'current',
            'variable' => ['$in' => self::TrendVariables], 'missionDay' => ['$gte' => $fromDay, '$lte' => $toDay],
        ], ['typeMap' => self::TypeMap]);

        $byVariable = [];

        foreach ($cursor as $observation) {
            $byVariable[$observation['variable']][$observation['missionDay']] = $observation;
        }

        $trends = [];

        foreach (self::TrendVariables as $variable) {
            $points = [];
            $sample = null;

            for ($day = $fromDay; $day <= $toDay; $day++) {
                $observation = $byVariable[$variable][$day] ?? null;
                $sample ??= $observation;
                $points[] = [
                    'missionDay' => $day,
                    'value' => $observation['value'] ?? null,
                    'quality' => $observation['quality'] ?? 'no_reading',
                    'observationId' => $observation['_id'] ?? null,
                ];
            }

            $trends[$variable] = ['unit' => $sample['unit'] ?? null, 'method' => $sample['method'] ?? null, 'points' => $points];
        }

        return $trends;
    }

    /**
     * @param  array<string, mixed>  $workspace
     * @return array<string, mixed>
     */
    private function sleepReference(string $workspaceId, string $crewId, array $workspace): array
    {
        $window = $workspace['policy']['baselineWindow'] ?? null;

        if ($window === null) {
            return ['available' => false, 'message' => $workspace['policy']['sleepRuleMessage'] ?? 'No mission rule configured'];
        }

        $series = [];

        foreach ($this->collection('observations')->find(['workspaceId' => $workspaceId, 'subjectId' => $crewId, 'variable' => 'sleep_duration', 'status' => 'current'], ['typeMap' => self::TypeMap]) as $observation) {
            $series[] = [
                'missionDay' => $observation['missionDay'], 'minutes' => $observation['value'], 'method' => $observation['method'],
                'quality' => $observation['quality'], 'observationId' => $observation['_id'], 'version' => $observation['version'],
            ];
        }

        $baseline = $this->sleepRule->personalBaseline($series, $window['fromDay'], $window['toDay']);

        return $baseline === null
            ? ['available' => false, 'message' => 'Fewer than '.$this->sleepRule->baselineMinNights.' valid diary nights in the reference window.']
            : ['available' => true, ...$baseline];
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function latestMeasurements(string $workspaceId, string $crewId): array
    {
        $pipeline = [
            ['$match' => ['workspaceId' => $workspaceId, 'subjectId' => $crewId, 'status' => 'current', 'variable' => ['$in' => self::SpotVariables]]],
            ['$sort' => ['observedAt' => -1]],
            ['$group' => ['_id' => ['$ifNull' => ['$seriesKey', ['$concat' => ['$variable', '|', '$method']]]], 'latest' => ['$first' => '$$ROOT']]],
            ['$replaceRoot' => ['newRoot' => '$latest']],
            ['$sort' => ['variable' => 1, 'observedAt' => -1]],
        ];

        return iterator_to_array($this->collection('observations')->aggregate($pipeline, ['typeMap' => self::TypeMap]), false);
    }

    /**
     * @return array{todayCheckin: bool, unavailableToday: list<string>, daysWithoutCheckin: list<int>}
     */
    private function missing(string $workspaceId, string $crewId, int $today): array
    {
        $submitted = [];

        foreach ($this->collection('checkins')->find(['workspaceId' => $workspaceId, 'subjectId' => $crewId, 'status' => 'submitted', 'missionDay' => ['$gte' => $today - 6]], ['typeMap' => self::TypeMap]) as $checkin) {
            $submitted[$checkin['missionDay']] = $checkin;
        }

        return [
            'todayCheckin' => isset($submitted[$today]),
            'unavailableToday' => $submitted[$today]['unavailableFields'] ?? [],
            'daysWithoutCheckin' => array_values(array_filter(range($today - 6, $today), fn (int $day): bool => ! isset($submitted[$day]))),
        ];
    }

    private function collection(string $name): Collection
    {
        return DB::connection('mongodb')->getCollection($name);
    }
}
