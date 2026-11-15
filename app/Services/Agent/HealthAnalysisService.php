<?php

namespace App\Services\Agent;

use App\Services\Agent\Contracts\AssessmentModel;
use App\Services\Media\MediaStore;
use App\Services\Notifications\NotificationCenter;
use App\Services\Vision\HeartRateEstimator;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;

/**
 * Runs a photo or webcam analysis end to end and stores every step in MongoDB:
 * `analyses` (input, model output, guardrails, usage), `observations`
 * (a "to verify" reading in its own method series), and, when escalation is
 * needed, a `follow_ups` review request plus a CMO `notifications` entry.
 */
final class HealthAnalysisService
{
    public const string Disclaimer = 'AI-assisted estimate. Not a diagnosis. The Crew Medical Officer reviews it.';

    private const array TypeMap = ['root' => 'array', 'document' => 'array', 'array' => 'array'];

    public function __construct(
        private readonly AssessmentModel $model,
        private readonly SafetyGuardrails $guardrails,
        private readonly MediaStore $media,
        private readonly HeartRateEstimator $heartRateEstimator,
        private readonly NotificationCenter $notifications,
    ) {}

    /**
     * @param  array{kind: string, subjectId: string, requestedBy: string, mediaId?: ?string, notes?: ?string, bodySite?: ?string, atRest?: ?bool, signal?: array{samples: list<array{0: float, 1: float, 2: float, 3: float}>}}  $input
     * @return array<string, mixed>
     */
    public function start(string $workspaceId, array $input): array
    {
        $kind = AnalysisKind::from($input['kind']);
        $heartRate = $kind === AnalysisKind::WebcamHeartRate
            ? $this->heartRateEstimator->estimate($input['signal']['samples'])
            : null;

        $analysisId = (string) Str::uuid();
        $now = new UTCDateTime(now('UTC'));

        $this->collection('analyses')->insertOne([
            '_id' => $analysisId,
            'workspaceId' => $workspaceId,
            'subjectId' => $input['subjectId'],
            'requestedBy' => $input['requestedBy'],
            'kind' => $kind->value,
            'status' => 'running',
            'input' => [
                'mediaId' => $input['mediaId'] ?? null,
                'notes' => $input['notes'] ?? null,
                'bodySite' => $input['bodySite'] ?? null,
                'atRest' => $input['atRest'] ?? null,
                'heartRateMeasurement' => $heartRate,
            ],
            'missionDay' => $this->missionDay($workspaceId),
            'disclaimer' => self::Disclaimer,
            'attempts' => 0,
            'createdAt' => $now,
        ]);

        return $this->run($workspaceId, $analysisId);
    }

    /**
     * Runs (or re-runs after a failure) a stored analysis.
     *
     * @return array<string, mixed>
     */
    public function run(string $workspaceId, string $analysisId): array
    {
        $analysis = $this->find($workspaceId, $analysisId);
        $kind = AnalysisKind::from($analysis['kind']);
        $subject = $this->crewMember($workspaceId, $analysis['subjectId']);
        $imageJpeg = null;

        if ($kind->needsPhoto()) {
            $imageJpeg = $this->media->find($workspaceId, (string) $analysis['input']['mediaId'])['bytes'] ?? null;
        }

        $request = new AgentRequest(
            kind: $kind,
            workspaceId: $workspaceId,
            subjectId: $analysis['subjectId'],
            subjectAlias: $subject['alias'] ?? $analysis['subjectId'],
            missionDay: $analysis['missionDay'],
            imageJpeg: $imageJpeg,
            heartRate: $analysis['input']['heartRateMeasurement'],
            atRest: $analysis['input']['atRest'],
            bodySite: $analysis['input']['bodySite'],
            crewNotes: $analysis['input']['notes'],
        );

        $this->collection('analyses')->updateOne(['_id' => $analysisId], ['$inc' => ['attempts' => 1], '$set' => ['status' => 'running']]);

        try {
            $result = $this->model->assess($request);
        } catch (AgentUnavailableException $exception) {
            $this->collection('analyses')->updateOne(['_id' => $analysisId], ['$set' => [
                'status' => 'failed',
                'error' => ['message' => $exception->getMessage(), 'retryable' => $exception->retryable],
                'failedAt' => new UTCDateTime(now('UTC')),
            ]]);

            return $this->find($workspaceId, $analysisId);
        }

        $checked = $this->guardrails->apply($request, $result->assessment, $result->retrievedSourceIds);
        $assessment = $checked['assessment'];
        $observationId = $this->recordObservation($request, $analysis, $assessment);
        $followUpId = $this->escalate($request, $analysis, $assessment, $observationId);

        $this->collection('analyses')->updateOne(['_id' => $analysisId], [
            '$set' => [
                'status' => 'completed',
                'assessment' => $assessment,
                'escalation' => $assessment['escalation'],
                'guardrails' => $checked['applied'],
                'sources' => $this->sourceSummaries($result->retrievedSourceIds),
                'toolCalls' => $result->toolCalls,
                'model' => ['id' => $result->model, 'promptVersion' => config('hexta.agent.prompt_version')],
                'usage' => $result->usage,
                'observationId' => $observationId,
                'followUpId' => $followUpId,
                'completedAt' => new UTCDateTime(now('UTC')),
            ],
            '$unset' => ['error' => ''],
        ]);

        return $this->find($workspaceId, $analysisId);
    }

    /**
     * @return array<string, mixed>
     */
    public function find(string $workspaceId, string $analysisId): array
    {
        $analysis = $this->collection('analyses')->findOne(['_id' => $analysisId, 'workspaceId' => $workspaceId], ['typeMap' => self::TypeMap]);

        abort_if($analysis === null, 404, 'Analysis not found in this workspace.');

        return $analysis;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function forSubject(string $workspaceId, string $subjectId, int $limit = 20): array
    {
        $cursor = $this->collection('analyses')->find(
            ['workspaceId' => $workspaceId, 'subjectId' => $subjectId],
            ['sort' => ['createdAt' => -1, '_id' => 1], 'limit' => $limit, 'typeMap' => self::TypeMap],
        );

        return iterator_to_array($cursor, false);
    }

    /**
     * Stores the reading as its own method series, always "to_verify".
     *
     * @param  array<string, mixed>  $analysis
     * @param  array<string, mixed>  $assessment
     */
    private function recordObservation(AgentRequest $request, array $analysis, array $assessment): ?string
    {
        $reading = match ($request->kind) {
            AnalysisKind::UrineColor => $assessment['urineColor'] === null ? null : [
                'variable' => 'urine_color', 'value' => $assessment['urineColor']['scale'], 'unit' => 'scale_1_8',
                'method' => 'photo_ai_estimate', 'context' => ['chart' => 'urine_color_8_point', 'unusualColor' => $assessment['urineColor']['unusualColor']],
            ],
            AnalysisKind::SkinRash => $assessment['skinFinding'] === null ? null : [
                'variable' => 'skin_observation', 'value' => null, 'unit' => null,
                'method' => 'photo_ai_description', 'context' => $assessment['skinFinding'],
            ],
            AnalysisKind::WebcamHeartRate => ($request->heartRate['bpm'] ?? null) === null ? null : [
                'variable' => 'heart_rate', 'value' => $request->heartRate['bpm'], 'unit' => 'bpm',
                'method' => 'webcam_rppg', 'context' => [
                    'atRest' => $request->atRest, 'snrDb' => $request->heartRate['snrDb'], 'signalQuality' => $request->heartRate['signalQuality'],
                ],
            ],
        };

        if ($reading === null) {
            return null;
        }

        $lineageId = "{$request->workspaceId}-{$request->subjectId}-{$reading['variable']}-{$analysis['_id']}";
        $observedAt = $analysis['createdAt'];

        $this->collection('observations')->updateOne(['_id' => "{$lineageId}-v1"], ['$setOnInsert' => [
            ...$reading,
            'workspaceId' => $request->workspaceId,
            'missionId' => $this->workspace($request->workspaceId)['missionId'] ?? null,
            'subjectId' => $request->subjectId,
            'context' => [...$reading['context'], 'analysisId' => $analysis['_id'], 'mediaId' => $analysis['input']['mediaId']],
            'quality' => 'to_verify',
            'author' => ['crewId' => $analysis['requestedBy'], 'role' => 'astronaut', 'assistedBy' => 'vision_agent'],
            'source' => 'hexta_vision_agent',
            'missionDay' => $analysis['missionDay'],
            'observedAt' => $observedAt,
            'recordedAt' => new UTCDateTime(now('UTC')),
            'lineageId' => $lineageId,
            'version' => 1,
            'status' => 'current',
        ]], ['upsert' => true]);

        return "{$lineageId}-v1";
    }

    /**
     * Opens a review request for the CMO and notifies them (idempotent keys).
     *
     * @param  array<string, mixed>  $analysis
     * @param  array<string, mixed>  $assessment
     */
    private function escalate(AgentRequest $request, array $analysis, array $assessment, ?string $observationId): ?string
    {
        $level = $assessment['escalation']['level'] ?? 'none';

        if ($level === 'none') {
            return null;
        }

        $followUpId = "followup-{$analysis['_id']}";
        $now = new UTCDateTime(now('UTC'));
        $cmos = $this->collection('crew_members')->find(['workspaceId' => $request->workspaceId, 'role' => 'cmo'], ['typeMap' => self::TypeMap]);
        $cmoIds = array_column(iterator_to_array($cmos, false), 'crewId');

        $this->collection('follow_ups')->updateOne(['_id' => $followUpId], ['$setOnInsert' => [
            'workspaceId' => $request->workspaceId,
            'type' => 'review_request',
            'origin' => 'vision_agent',
            'authorId' => $analysis['requestedBy'],
            'subjectId' => $request->subjectId,
            'targetRole' => 'cmo',
            'targetId' => $cmoIds[0] ?? null,
            'priority' => $level,
            'status' => 'open',
            'reason' => implode(' ', $assessment['escalation']['reasons'] ?? []) ?: $assessment['summary'],
            'evidence' => ['analysisId' => $analysis['_id'], 'observationId' => $observationId, 'mediaId' => $analysis['input']['mediaId']],
            'createdAt' => $now,
        ]], ['upsert' => true]);

        foreach ($cmoIds as $cmoId) {
            $this->notifications->upsert($request->workspaceId, "analysis:{$analysis['_id']}:review", $cmoId, [
                'type' => 'crew_review_requested',
                'title' => $level === 'cmo_urgent' ? 'Crew review requested (priority)' : 'Crew review requested',
                'body' => "{$request->subjectAlias}: {$assessment['summary']}",
                'target' => ['type' => 'follow_up', 'id' => $followUpId, 'analysisId' => $analysis['_id']],
                'priority' => $level,
            ], $now);
        }

        return $followUpId;
    }

    /**
     * @param  list<string>  $ids
     * @return list<array{id: string, title: string, source: string, url: ?string, validated: bool}>
     */
    private function sourceSummaries(array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        $cursor = $this->collection('knowledge_documents')->find(
            ['_id' => ['$in' => $ids]],
            ['projection' => ['title' => 1, 'source' => 1, 'url' => 1, 'validated' => 1], 'sort' => ['_id' => 1], 'typeMap' => self::TypeMap],
        );

        return array_map(fn (array $document): array => [
            'id' => (string) $document['_id'],
            'title' => (string) $document['title'],
            'source' => (string) ($document['source'] ?? ''),
            'url' => $document['url'] ?? null,
            'validated' => (bool) ($document['validated'] ?? false),
        ], iterator_to_array($cursor, false));
    }

    /**
     * Current mission day from the workspace clock (controlled in Start demo).
     */
    private function missionDay(string $workspaceId): ?int
    {
        $workspace = $this->workspace($workspaceId);

        if ($workspace === null || ! isset($workspace['missionEpoch'])) {
            return null;
        }

        $epoch = CarbonImmutable::instance($workspace['missionEpoch']->toDateTime());
        $now = ($workspace['clock']['type'] ?? 'real') === 'controlled'
            ? CarbonImmutable::instance($workspace['clock']['current']->toDateTime())
            : CarbonImmutable::now('UTC');

        return (int) floor($epoch->diffInDays($now));
    }

    /**
     * @return array<string, mixed>|null
     */
    private function workspace(string $workspaceId): ?array
    {
        return $this->collection('workspaces')->findOne(['_id' => $workspaceId], ['typeMap' => self::TypeMap]);
    }

    /**
     * @return array<string, mixed>
     */
    private function crewMember(string $workspaceId, string $crewId): array
    {
        return $this->collection('crew_members')->findOne(['workspaceId' => $workspaceId, 'crewId' => $crewId], ['typeMap' => self::TypeMap]) ?? [];
    }

    private function collection(string $name): Collection
    {
        return DB::connection('mongodb')->getCollection($name);
    }
}
