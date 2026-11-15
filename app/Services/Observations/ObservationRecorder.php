<?php

namespace App\Services\Observations;

use App\Services\Alerts\PersonalBaselineService;
use App\Services\Alerts\ThresholdAlertService;
use App\Services\Workspace\WorkspaceClock;
use App\Support\CanonicalJson;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;

/**
 * Versioned observations (cahier des charges p.9, p.15, p.18).
 *
 * - A client-generated id names the lineage; each correction adds a version
 *   and marks the previous one "superseded" — nothing is overwritten.
 * - Re-sending identical content is a no-op (replayable offline sync).
 * - Value and unit are kept as entered; quality flags explain what must be
 *   checked instead of rejecting a reading.
 * - A seriesKey separates incomparable series (site, specimen, context...).
 */
final class ObservationRecorder
{
    private const array TypeMap = ['root' => 'array', 'document' => 'array', 'array' => 'array'];

    /** Fields that define the content of a version (for idempotency). */
    private const array ContentFields = ['variable', 'value', 'unit', 'method', 'device', 'context', 'observedAt', 'missionDay'];

    public function __construct(
        private readonly WorkspaceClock $clock,
        private readonly ?ThresholdAlertService $thresholdAlerts = null,
        private readonly ?PersonalBaselineService $baselineService = null,
    ) {}

    /**
     * Creates the lineage, or adds a version if the content changed.
     *
     * @param  array{variable: string, value: mixed, unit: ?string, method: string, device?: ?string, context?: array<string, mixed>, observedAt?: ?string, missionDay?: ?int}  $reading
     * @param  array{crewId: string, role: string}  $author
     * @return array{observation: array<string, mixed>, created: bool}
     */
    public function record(string $workspaceId, string $subjectId, string $lineageId, array $reading, array $author, string $source = 'crew_entry', ?string $reason = null): array
    {
        $current = $this->current($workspaceId, $lineageId);
        $document = $this->buildDocument($workspaceId, $subjectId, $lineageId, $reading, $author, $source);

        if ($current !== null && $current['subjectId'] !== $subjectId) {
            throw new ObservationConflictException('This observation id already belongs to another crew member.');
        }

        if ($current !== null && $this->contentHash($current) === $this->contentHash($document)) {
            return ['observation' => $current, 'created' => false];
        }

        $version = ($current['version'] ?? 0) + 1;
        $document['_id'] = "{$lineageId}-v{$version}";
        $document['version'] = $version;
        $document['correctionReason'] = $current === null ? null : $reason;
        $document['supersedes'] = $current['_id'] ?? null;

        $this->collection()->insertOne($document);

        if ($current !== null) {
            $this->collection()->updateOne(['_id' => $current['_id']], ['$set' => [
                'status' => 'superseded',
                'supersededBy' => $document['_id'],
            ]]);
        }

        $observation = $this->collection()->findOne(['_id' => $document['_id']], ['typeMap' => self::TypeMap]);

        // Evaluate thresholds and baseline (optional services)
        $this->evaluateAlerts($workspaceId, $observation);

        return ['observation' => $observation, 'created' => true];
    }

    /**
     * @return array<string, mixed>|null
     */
    public function current(string $workspaceId, string $lineageId): ?array
    {
        return $this->collection()->findOne(
            ['workspaceId' => $workspaceId, 'lineageId' => $lineageId],
            ['sort' => ['version' => -1], 'typeMap' => self::TypeMap],
        );
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function history(string $workspaceId, string $lineageId): array
    {
        return iterator_to_array($this->collection()->find(
            ['workspaceId' => $workspaceId, 'lineageId' => $lineageId],
            ['sort' => ['version' => 1], 'typeMap' => self::TypeMap],
        ), false);
    }

    /**
     * Current versions for one crew member, newest first.
     *
     * @param  array{variable?: ?string, fromDay?: ?int, toDay?: ?int}  $filters
     * @return list<array<string, mixed>>
     */
    public function list(string $workspaceId, string $subjectId, array $filters = [], int $limit = 500): array
    {
        $query = ['workspaceId' => $workspaceId, 'subjectId' => $subjectId, 'status' => 'current'];

        if (! empty($filters['variable'])) {
            $query['variable'] = $filters['variable'];
        }

        if (isset($filters['fromDay']) || isset($filters['toDay'])) {
            $query['missionDay'] = array_filter([
                '$gte' => $filters['fromDay'] ?? null,
                '$lte' => $filters['toDay'] ?? null,
            ], fn (?int $day): bool => $day !== null);
        }

        return iterator_to_array($this->collection()->find($query, [
            'sort' => ['observedAt' => -1, '_id' => 1],
            'limit' => $limit,
            'typeMap' => self::TypeMap,
        ]), false);
    }

    /**
     * Quality rules (recette V11): readings are kept, flags say what to check.
     *
     * @param  array<string, mixed>  $context
     * @return array{quality: string, flags: list<string>}
     */
    public function assessQuality(string $variable, mixed $value, ?string $unit, array $context): array
    {
        if ($value === null) {
            return ['quality' => 'missing', 'flags' => ['not_recorded']];
        }

        $flags = match ($variable) {
            'blood_pressure' => array_filter([
                ($value['systolic'] ?? 0) <= ($value['diastolic'] ?? 0) ? 'systolic_not_above_diastolic' : null,
                ! isset($context['atRest']) ? 'rest_context_unknown' : null,
            ]),
            'spo2' => array_filter([
                in_array($context['signalQuality'] ?? 'unknown', ['unknown', 'insufficient'], true) ? 'signal_quality_unverified' : null,
            ]),
            'temperature' => array_filter([
                ($context['site'] ?? 'unknown') === 'unknown' ? 'site_unknown' : null,
            ]),
            'glucose' => array_filter([
                ($context['specimen'] ?? 'unknown') === 'unknown' ? 'specimen_unknown' : null,
                ($context['context'] ?? 'unknown') === 'unknown' ? 'meal_context_unknown' : null,
            ]),
            'resting_heart_rate' => array_filter([
                ($context['atRest'] ?? null) !== true ? 'rest_context_missing' : null,
            ]),
            'actigraphy_sleep_duration' => array_filter([
                ($context['wearStatus'] ?? 'unknown') === 'unknown' ? 'wear_status_unknown' : null,
                ($context['wearStatus'] ?? null) === 'not_worn' && $value !== null ? 'device_not_worn_but_value_provided' : null,
            ]),
            'pvt_reaction_time' => array_filter([
                ! isset($context['protocol']) ? 'protocol_missing' : null,
                ($context['simulated'] ?? false) === true ? 'simulated_data' : null,
            ]),
            'cabin_co2' => array_filter([
                $unit === 'ppm' && ! isset($context['absolutePressure']) ? 'conversion_unavailable' : null,
                ! isset($context['sensorId']) ? 'sensor_id_missing' : null,
            ]),
            'radiation_dose_rate', 'radiation_absorbed_dose' => array_filter([
                ! isset($context['sensorId']) ? 'sensor_id_missing' : null,
                ! isset($context['source']) ? 'source_missing' : null,
            ]),
            default => [],
        };

        return ['quality' => $flags === [] ? 'valid' : 'to_verify', 'flags' => array_values($flags)];
    }

    /**
     * Readings with different site, specimen, meal context, method or unit
     * are never drawn on the same curve.
     *
     * @param  array<string, mixed>  $context
     */
    public static function seriesKey(string $variable, string $method, ?string $unit, array $context): string
    {
        $qualifier = match ($variable) {
            'temperature' => 'site='.($context['site'] ?? 'unknown'),
            'glucose' => 'specimen='.($context['specimen'] ?? 'unknown').';context='.($context['context'] ?? 'unknown'),
            'blood_pressure' => 'rest='.json_encode($context['atRest'] ?? null).';posture='.($context['posture'] ?? 'unknown'),
            'resting_heart_rate', 'heart_rate' => 'rest='.json_encode($context['atRest'] ?? null),
            'spo2' => 'o2='.json_encode($context['supplementalOxygen'] ?? null),
            'actigraphy_sleep_duration' => 'sensor='.($context['sensorId'] ?? 'unknown'),
            'pvt_reaction_time' => 'protocol='.($context['protocol'] ?? 'unknown').';device='.($context['device'] ?? 'unknown'),
            'cabin_co2', 'cabin_temperature' => 'sensor='.($context['sensorId'] ?? 'unknown').';assignment='.($context['assignment'] ?? 'unknown'),
            'radiation_dose_rate', 'radiation_absorbed_dose' => 'sensor='.($context['sensorId'] ?? 'unknown').';assignment='.($context['assignment'] ?? 'unknown'),
            default => 'main',
        };

        return "{$variable}|{$method}|".($unit ?? '-')."|{$qualifier}";
    }

    /**
     * @param  array<string, mixed>  $reading
     * @param  array{crewId: string, role: string}  $author
     * @return array<string, mixed>
     */
    private function buildDocument(string $workspaceId, string $subjectId, string $lineageId, array $reading, array $author, string $source): array
    {
        $context = $reading['context'] ?? [];
        $observedAt = isset($reading['observedAt'])
            ? CarbonImmutable::parse($reading['observedAt'])->utc()
            : $this->clock->now($workspaceId);
        $quality = $this->assessQuality($reading['variable'], $reading['value'], $reading['unit'] ?? null, $context);

        return [
            'workspaceId' => $workspaceId,
            'missionId' => $this->clock->missionId($workspaceId),
            'subjectId' => $subjectId,
            'variable' => $reading['variable'],
            'value' => $reading['value'],
            'unit' => $reading['unit'] ?? null,
            'method' => $reading['method'],
            'device' => $reading['device'] ?? null,
            'context' => $context,
            'quality' => $quality['quality'],
            'qualityFlags' => $quality['flags'],
            'seriesKey' => self::seriesKey($reading['variable'], $reading['method'], $reading['unit'] ?? null, $context),
            'author' => $author,
            'source' => $source,
            'missionDay' => $reading['missionDay'] ?? $this->clock->missionDay($workspaceId, $observedAt),
            'observedAt' => new UTCDateTime($observedAt),
            'recordedAt' => new UTCDateTime(now('UTC')),
            'lineageId' => $lineageId,
            'status' => 'current',
        ];
    }

    /**
     * @param  array<string, mixed>  $document
     */
    private function contentHash(array $document): string
    {
        $content = array_intersect_key($document, array_flip(self::ContentFields));
        $content['observedAt'] = $content['observedAt'] instanceof UTCDateTime
            ? $content['observedAt']->toDateTime()->getTimestamp()
            : $content['observedAt'];

        return CanonicalJson::sha256($content);
    }

    /**
     * Evaluate observation against thresholds and personal baseline.
     *
     * @param  array<string, mixed>  $observation
     */
    private function evaluateAlerts(string $workspaceId, array $observation): void
    {
        // Skip if services not injected (tests, etc.)
        if ($this->thresholdAlerts === null && $this->baselineService === null) {
            return;
        }

        // Skip environmental readings (no personal thresholds)
        if (($observation['context']['assignment'] ?? null) === 'module') {
            return;
        }

        // Evaluate against absolute thresholds (health_indicators.json)
        if ($this->thresholdAlerts !== null) {
            $this->thresholdAlerts->evaluate($workspaceId, $observation);
        }

        // Evaluate against personal baseline (Z-score)
        if ($this->baselineService !== null && isset($observation['subjectId'])) {
            $this->evaluateBaseline($workspaceId, $observation);
        }
    }

    /**
     * Evaluate observation against personal baseline.
     *
     * @param  array<string, mixed>  $observation
     */
    private function evaluateBaseline(string $workspaceId, array $observation): void
    {
        $workspace = $this->clock->workspace($workspaceId);
        $baselineWindow = $workspace['policy']['baselineWindow'] ?? null;

        if ($baselineWindow === null) {
            return;
        }

        $baseline = $this->baselineService->getOrCreateBaseline(
            $workspaceId,
            $observation['subjectId'],
            $observation['variable'],
            $baselineWindow['fromDay'],
            $baselineWindow['toDay']
        );

        if ($baseline === null || ! isset($baseline['baseline'])) {
            return;
        }

        $zscoreResult = $this->baselineService->evaluateZScore(
            $observation['value'],
            $observation['variable'],
            $baseline['baseline']
        );

        if ($zscoreResult === null) {
            return;
        }

        // Store Z-score in observation for frontend display
        $this->collection()->updateOne(['_id' => $observation['_id']], [
            '$set' => [
                'baselineAnalysis' => $zscoreResult,
            ],
        ]);
    }

    private function collection(): Collection
    {
        return DB::connection('mongodb')->getCollection('observations');
    }
}
