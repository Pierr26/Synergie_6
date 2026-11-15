<?php

namespace App\Services\Alerts;

use Illuminate\Support\Facades\DB;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;

/**
 * Personal baseline calculation using Z-score methodology.
 *
 * Implements approach from baseline_C003.json (Banque de Données):
 * - Calculate mean and SD from baseline window (typically first 7-14 mission days)
 * - Z-score = (value - mean) / SD
 * - Green: |Z| < 1
 * - Orange: 1 ≤ |Z| < 2
 * - Red: |Z| ≥ 2
 *
 * References:
 * - baseline_C003.json: Example baseline from NASA OSDR OSD-575
 * - Inspiration4 mission data (3-day orbital flight)
 */
final class PersonalBaselineService
{
    private const array TypeMap = ['root' => 'array', 'document' => 'array', 'array' => 'array'];

    /** Minimum observations required to calculate reliable baseline */
    private const int MinObservations = 3;

    /**
     * Calculate personal baseline for a crew member and variable.
     *
     * @return array{mean: float, sd: float, median: float, n: int, fromDay: int, toDay: int}|null
     */
    public function calculateBaseline(string $workspaceId, string $subjectId, string $variable, int $fromDay, int $toDay): ?array
    {
        $observations = $this->getObservations($workspaceId, $subjectId, $variable, $fromDay, $toDay);

        if (count($observations) < self::MinObservations) {
            return null;
        }

        $values = array_map(fn ($obs): float => $this->extractNumericValue($variable, $obs['value']), $observations);
        $values = array_filter($values, fn ($v): bool => $v !== null);

        if (count($values) < self::MinObservations) {
            return null;
        }

        sort($values);

        $mean = array_sum($values) / count($values);
        $variance = array_sum(array_map(fn ($v): float => ($v - $mean) ** 2, $values)) / count($values);
        $sd = sqrt($variance);

        $n = count($values);
        $middle = intdiv($n, 2);
        $median = $n % 2 === 0 ? ($values[$middle - 1] + $values[$middle]) / 2 : $values[$middle];

        return [
            'mean' => round($mean, 2),
            'sd' => round($sd, 2),
            'median' => round($median, 2),
            'n' => $n,
            'fromDay' => $fromDay,
            'toDay' => $toDay,
        ];
    }

    /**
     * Evaluate observation against personal baseline using Z-score.
     *
     * @param  array<string, mixed>  $baseline
     * @return array{zscore: float, level: string, deviation: string}|null
     */
    public function evaluateZScore(mixed $value, string $variable, array $baseline): ?array
    {
        $numericValue = $this->extractNumericValue($variable, $value);

        if ($numericValue === null || $baseline['sd'] == 0) {
            return null;
        }

        $zscore = ($numericValue - $baseline['mean']) / $baseline['sd'];
        $absZ = abs($zscore);

        $level = match (true) {
            $absZ >= 2 => 'red',
            $absZ >= 1 => 'orange',
            default => 'green',
        };

        $deviation = $zscore > 0 ? 'above' : ($zscore < 0 ? 'below' : 'normal');

        return [
            'zscore' => round($zscore, 2),
            'level' => $level,
            'deviation' => $deviation,
        ];
    }

    /**
     * Get or create cached baseline for crew member.
     *
     * @return array<string, mixed>|null
     */
    public function getOrCreateBaseline(string $workspaceId, string $subjectId, string $variable, int $fromDay, int $toDay): ?array
    {
        $baselineId = "baseline-{$workspaceId}-{$subjectId}-{$variable}-J{$fromDay}-J{$toDay}";

        $existing = $this->baselines()->findOne(['_id' => $baselineId], ['typeMap' => self::TypeMap]);

        if ($existing !== null) {
            return $existing;
        }

        $baseline = $this->calculateBaseline($workspaceId, $subjectId, $variable, $fromDay, $toDay);

        if ($baseline === null) {
            return null;
        }

        $document = [
            '_id' => $baselineId,
            'workspaceId' => $workspaceId,
            'subjectId' => $subjectId,
            'variable' => $variable,
            'fromDay' => $fromDay,
            'toDay' => $toDay,
            'baseline' => $baseline,
            'method' => 'zscore',
            'createdAt' => new UTCDateTime(now('UTC')),
        ];

        $this->baselines()->insertOne($document);

        return $document;
    }

    /**
     * Check for significant trend (>10% change over period).
     *
     * @param  array<string, mixed>  $baseline
     */
    public function hasSignificantTrend(mixed $currentValue, mixed $previousValue, string $variable, array $baseline): bool
    {
        $current = $this->extractNumericValue($variable, $currentValue);
        $previous = $this->extractNumericValue($variable, $previousValue);

        if ($current === null || $previous === null || $previous == 0) {
            return false;
        }

        $percentChange = abs(($current - $previous) / $previous) * 100;

        return $percentChange > 10;
    }

    /**
     * Extract numeric value from observation (handles blood_pressure, etc.).
     */
    private function extractNumericValue(string $variable, mixed $value): ?float
    {
        if ($value === null) {
            return null;
        }

        if (is_numeric($value)) {
            return (float) $value;
        }

        // Special cases
        return match ($variable) {
            'blood_pressure' => isset($value['systolic']) ? (float) $value['systolic'] : null,
            default => null,
        };
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function getObservations(string $workspaceId, string $subjectId, string $variable, int $fromDay, int $toDay): array
    {
        $cursor = $this->observations()->find([
            'workspaceId' => $workspaceId,
            'subjectId' => $subjectId,
            'variable' => $variable,
            'status' => 'current',
            'quality' => 'valid',
            'missionDay' => ['$gte' => $fromDay, '$lte' => $toDay],
        ], [
            'sort' => ['missionDay' => 1],
            'typeMap' => self::TypeMap,
        ]);

        return iterator_to_array($cursor, false);
    }

    private function observations(): Collection
    {
        return DB::connection('mongodb')->getCollection('observations');
    }

    private function baselines(): Collection
    {
        return DB::connection('mongodb')->getCollection('personal_baselines');
    }
}
