<?php

namespace App\Services\Alerts;

use App\Services\Notifications\NotificationCenter;
use App\Services\Workspace\WorkspaceClock;
use Illuminate\Support\Facades\DB;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;

/**
 * Threshold-based alerting using health_indicators.json from Banque de Données.
 *
 * Evaluates observations against NASA HRP-derived thresholds:
 * - watch: Yellow alert, CMO notification
 * - critical: Red alert, urgent CMO notification
 *
 * References:
 * - health_indicators.json: Thresholds per variable
 * - NASA HRP Evidence Reports
 */
final class ThresholdAlertService
{
    private const array TypeMap = ['root' => 'array', 'document' => 'array', 'array' => 'array'];

    /** @var array<string, array<string, mixed>> Loaded from health_indicators.json */
    private array $indicators = [];

    public function __construct(
        private readonly WorkspaceClock $clock,
        private readonly NotificationCenter $notifications,
    ) {
        $this->loadIndicators();
    }

    /**
     * Evaluate observation against thresholds and create alerts if needed.
     *
     * @param  array<string, mixed>  $observation
     * @return array{alert: array<string, mixed>|null, level: string, exceeded: list<string>}
     */
    public function evaluate(string $workspaceId, array $observation): array
    {
        $variable = $observation['variable'];
        $value = $observation['value'];
        $subjectId = $observation['subjectId'];
        $missionDay = $observation['missionDay'];

        if ($value === null || ! isset($this->indicators[$variable])) {
            return ['alert' => null, 'level' => 'none', 'exceeded' => []];
        }

        $indicator = $this->indicators[$variable];
        $thresholds = $indicator['thresholds'] ?? [];
        $unit = $indicator['unit'] ?? null;

        // Convert multi-value observations to single value for threshold comparison
        $numericValue = $this->extractNumericValue($variable, $value);

        if ($numericValue === null) {
            return ['alert' => null, 'level' => 'none', 'exceeded' => []];
        }

        // Check thresholds in order: critical > watch
        $level = 'none';
        $exceeded = [];

        if ($this->exceedsCritical($numericValue, $thresholds)) {
            $level = 'critical';
            $exceeded = $this->getCriticalThresholds($numericValue, $thresholds);
        } elseif ($this->exceedsWatch($numericValue, $thresholds)) {
            $level = 'watch';
            $exceeded = $this->getWatchThresholds($numericValue, $thresholds);
        }

        if ($level === 'none') {
            return ['alert' => null, 'level' => 'none', 'exceeded' => []];
        }

        // Create or update alert
        $alert = $this->upsertAlert($workspaceId, $subjectId, $variable, $observation['_id'], $numericValue, $unit, $level, $exceeded, $missionDay);

        // Notify CMO
        $this->notifyCmos($workspaceId, $subjectId, $variable, $alert, $level);

        return ['alert' => $alert, 'level' => $level, 'exceeded' => $exceeded];
    }

    /**
     * Extract numeric value from observation value (handles blood_pressure, etc.).
     */
    private function extractNumericValue(string $variable, mixed $value): ?float
    {
        if (is_numeric($value)) {
            return (float) $value;
        }

        // Special cases
        return match ($variable) {
            'blood_pressure' => isset($value['systolic']) ? (float) $value['systolic'] : null,
            default => null,
        };
    }

    private function exceedsCritical(float $value, array $thresholds): bool
    {
        if (isset($thresholds['critical']) && $value >= $thresholds['critical']) {
            return true;
        }

        if (isset($thresholds['critical_high']) && $value >= $thresholds['critical_high']) {
            return true;
        }

        if (isset($thresholds['critical_low']) && $value <= $thresholds['critical_low']) {
            return true;
        }

        return false;
    }

    private function exceedsWatch(float $value, array $thresholds): bool
    {
        if (isset($thresholds['watch']) && $value >= $thresholds['watch']) {
            return true;
        }

        if (isset($thresholds['watch_high']) && $value >= $thresholds['watch_high']) {
            return true;
        }

        if (isset($thresholds['watch_low']) && $value <= $thresholds['watch_low']) {
            return true;
        }

        return false;
    }

    /**
     * @return list<string>
     */
    private function getCriticalThresholds(float $value, array $thresholds): array
    {
        $exceeded = [];

        if (isset($thresholds['critical']) && $value >= $thresholds['critical']) {
            $exceeded[] = "critical (≥{$thresholds['critical']})";
        }

        if (isset($thresholds['critical_high']) && $value >= $thresholds['critical_high']) {
            $exceeded[] = "critical_high (≥{$thresholds['critical_high']})";
        }

        if (isset($thresholds['critical_low']) && $value <= $thresholds['critical_low']) {
            $exceeded[] = "critical_low (≤{$thresholds['critical_low']})";
        }

        return $exceeded;
    }

    /**
     * @return list<string>
     */
    private function getWatchThresholds(float $value, array $thresholds): array
    {
        $exceeded = [];

        if (isset($thresholds['watch']) && $value >= $thresholds['watch']) {
            $exceeded[] = "watch (≥{$thresholds['watch']})";
        }

        if (isset($thresholds['watch_high']) && $value >= $thresholds['watch_high']) {
            $exceeded[] = "watch_high (≥{$thresholds['watch_high']})";
        }

        if (isset($thresholds['watch_low']) && $value <= $thresholds['watch_low']) {
            $exceeded[] = "watch_low (≤{$thresholds['watch_low']})";
        }

        return $exceeded;
    }

    /**
     * @param  list<string>  $exceeded
     * @return array<string, mixed>
     */
    private function upsertAlert(string $workspaceId, string $subjectId, string $variable, string $observationId, float $value, ?string $unit, string $level, array $exceeded, int $missionDay): array
    {
        $now = new UTCDateTime($this->clock->now($workspaceId));
        $alertKey = "threshold-{$variable}-{$level}";
        $alertId = "alert-{$workspaceId}-{$subjectId}-{$alertKey}";

        $indicator = $this->indicators[$variable];

        $this->alerts()->updateOne(['_id' => $alertId], [
            '$setOnInsert' => [
                '_id' => $alertId,
                'workspaceId' => $workspaceId,
                'missionId' => $this->clock->missionId($workspaceId),
                'subjectId' => $subjectId,
                'type' => 'threshold',
                'variable' => $variable,
                'label' => $indicator['label'] ?? $variable,
                'alertKey' => $alertKey,
                'createdAt' => $now,
                'status' => 'needs_review',
            ],
            '$set' => [
                'level' => $level,
                'value' => $value,
                'unit' => $unit,
                'thresholdsExceeded' => $exceeded,
                'observationId' => $observationId,
                'missionDay' => $missionDay,
                'updatedAt' => $now,
                'hazards' => $indicator['hazards'] ?? [],
                'refMin' => $indicator['refMin'] ?? null,
                'refMax' => $indicator['refMax'] ?? null,
                'refSource' => $indicator['refSource'] ?? null,
            ],
        ], ['upsert' => true]);

        return $this->alerts()->findOne(['_id' => $alertId], ['typeMap' => self::TypeMap]);
    }

    /**
     * @param  array<string, mixed>  $alert
     */
    private function notifyCmos(string $workspaceId, string $subjectId, string $variable, array $alert, string $level): void
    {
        $members = DB::connection('mongodb')->getCollection('crew_members');
        $alias = $members->findOne(['workspaceId' => $workspaceId, 'crewId' => $subjectId])['alias'] ?? $subjectId;
        $indicator = $this->indicators[$variable];
        $label = $indicator['label'] ?? $variable;

        $priority = $level === 'critical' ? 'cmo_urgent' : 'cmo_review';
        $title = $level === 'critical' ? 'Critical health threshold exceeded' : 'Health threshold watch';
        $thresholds = implode(', ', $alert['thresholdsExceeded'] ?? []);

        $body = "{$alias}: {$label} = {$alert['value']} {$alert['unit']} exceeds {$thresholds}.";

        if (! empty($alert['hazards'])) {
            $body .= ' Related NASA HRP hazards: '.implode(', ', $alert['hazards']).'.';
        }

        foreach ($members->find(['workspaceId' => $workspaceId, 'role' => 'cmo']) as $cmo) {
            $this->notifications->upsert($workspaceId, "threshold_alert:{$alert['alertKey']}", $cmo['crewId'], [
                'type' => 'threshold_alert',
                'title' => $title,
                'body' => $body,
                'target' => ['type' => 'alert', 'alertId' => $alert['_id'], 'subjectId' => $subjectId],
                'priority' => $priority,
            ], new UTCDateTime($this->clock->now($workspaceId)));
        }
    }

    /**
     * Load health indicators from JSON file.
     */
    private function loadIndicators(): void
    {
        $jsonPath = base_path('../Banque Données Health Monitoring/03 Code &amp_ reproductibilité/health_indicators.json');

        if (! file_exists($jsonPath)) {
            // Fallback to empty if file not found (tests, etc.)
            $this->indicators = [];

            return;
        }

        $data = json_decode(file_get_contents($jsonPath), true);

        foreach ($data as $indicator) {
            $this->indicators[$indicator['_id']] = $indicator;
        }
    }

    private function alerts(): Collection
    {
        return DB::connection('mongodb')->getCollection('alerts');
    }
}
