<?php

namespace App\Services\Lab;

/**
 * Compares a haemoglobin or haematocrit result with a closed reference
 * interval (cahier des charges p.10-11, recette V03).
 *
 * Values are normalised to a canonical unit (Hb: g/L, Hct: %) and compared
 * before any rounding. Bounds are inclusive. The laboratory flag is kept
 * apart and never replaces this comparison.
 */
final class LabIntervalEvaluator
{
    public const string Below = 'below';

    public const string Within = 'within';

    public const string Above = 'above';

    public const string ReferenceUnavailable = 'reference_unavailable';

    public const string PendingVerification = 'pending_verification';

    /**
     * Conversion factors towards the canonical unit of each analyte.
     *
     * @var array<string, array{loinc: string, canonicalUnit: string, factors: array<string, float>}>
     */
    public const array Analytes = [
        'hemoglobin' => [
            'loinc' => '718-7',
            'canonicalUnit' => 'g/L',
            'factors' => ['g/L' => 1.0, 'g/dL' => 10.0],
        ],
        'hematocrit' => [
            'loinc' => '4544-3',
            'canonicalUnit' => '%',
            'factors' => ['%' => 1.0, 'L/L' => 100.0],
        ],
    ];

    /**
     * Removes binary floating-point noise from unit conversion
     * (0.42 L/L x 100 must equal 42 %), without clinical rounding.
     */
    private const int FloatNoiseDecimals = 9;

    /** @var list<string> */
    public const array VerifiedStatuses = ['final', 'corrected'];

    public function normalize(string $analyte, float $value, ?string $unit): ?float
    {
        $factor = self::Analytes[$analyte]['factors'][$unit ?? ''] ?? null;

        if ($factor === null) {
            return null;
        }

        return round($value * $factor, self::FloatNoiseDecimals);
    }

    /**
     * @param  array{analyte: string, value: float|int|null, unit: ?string, status: ?string, verified?: bool}  $result
     * @param  array{low: float|int|null, high: float|int|null, unit: ?string}|null  $interval
     * @return array{status: string, normalizedValue: ?float, canonicalUnit: ?string, reason: ?string}
     */
    public function evaluate(array $result, ?array $interval): array
    {
        $analyte = $result['analyte'];
        $canonicalUnit = self::Analytes[$analyte]['canonicalUnit'] ?? null;

        if ($canonicalUnit === null) {
            return $this->outcome(self::ReferenceUnavailable, null, null, 'unsupported_analyte');
        }

        if (! is_numeric($result['value']) || $result['unit'] === null || $result['unit'] === '') {
            return $this->outcome(self::PendingVerification, null, $canonicalUnit, 'missing_value_or_unit');
        }

        $normalized = $this->normalize($analyte, (float) $result['value'], $result['unit']);

        if ($normalized === null) {
            return $this->outcome(self::PendingVerification, null, $canonicalUnit, 'unknown_unit');
        }

        if (! in_array($result['status'] ?? null, self::VerifiedStatuses, true) || ($result['verified'] ?? true) === false) {
            return $this->outcome(self::PendingVerification, $normalized, $canonicalUnit, 'result_not_final_or_unverified');
        }

        if ($interval === null || ! is_numeric($interval['low'] ?? null) || ! is_numeric($interval['high'] ?? null)) {
            return $this->outcome(self::ReferenceUnavailable, $normalized, $canonicalUnit, 'interval_missing_or_open');
        }

        $low = $this->normalize($analyte, (float) $interval['low'], $interval['unit'] ?? null);
        $high = $this->normalize($analyte, (float) $interval['high'], $interval['unit'] ?? null);

        if ($low === null || $high === null) {
            return $this->outcome(self::ReferenceUnavailable, $normalized, $canonicalUnit, 'interval_unit_not_applicable');
        }

        $status = match (true) {
            $normalized < $low => self::Below,
            $normalized > $high => self::Above,
            default => self::Within,
        };

        return $this->outcome($status, $normalized, $canonicalUnit, null);
    }

    /**
     * @return array{status: string, normalizedValue: ?float, canonicalUnit: ?string, reason: ?string}
     */
    private function outcome(string $status, ?float $normalizedValue, ?string $canonicalUnit, ?string $reason): array
    {
        return [
            'status' => $status,
            'normalizedValue' => $normalizedValue,
            'canonicalUnit' => $canonicalUnit,
            'reason' => $reason,
        ];
    }
}
