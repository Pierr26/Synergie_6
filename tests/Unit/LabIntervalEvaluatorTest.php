<?php

namespace Tests\Unit;

use App\Services\Lab\LabIntervalEvaluator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class LabIntervalEvaluatorTest extends TestCase
{
    private const array SyntheticHbInterval = ['low' => 140, 'high' => 170, 'unit' => 'g/L'];

    private LabIntervalEvaluator $evaluator;

    protected function setUp(): void
    {
        parent::setUp();

        $this->evaluator = new LabIntervalEvaluator;
    }

    /**
     * @return array<string, array{float|int, string}>
     */
    public static function hemoglobinBoundaryProvider(): array
    {
        return [
            '139 g/L is below' => [139, LabIntervalEvaluator::Below],
            '140 g/L is within (inclusive)' => [140, LabIntervalEvaluator::Within],
            '170 g/L is within (inclusive)' => [170, LabIntervalEvaluator::Within],
            '171 g/L is above' => [171, LabIntervalEvaluator::Above],
            '139.99 g/L compared before rounding' => [139.99, LabIntervalEvaluator::Below],
        ];
    }

    #[DataProvider('hemoglobinBoundaryProvider')]
    public function test_hemoglobin_bounds_are_inclusive(float|int $value, string $expected): void
    {
        $result = $this->evaluator->evaluate(
            ['analyte' => 'hemoglobin', 'value' => $value, 'unit' => 'g/L', 'status' => 'final'],
            self::SyntheticHbInterval,
        );

        $this->assertSame($expected, $result['status']);
    }

    public function test_hemoglobin_in_g_per_dl_is_converted_to_g_per_l(): void
    {
        $result = $this->evaluator->evaluate(
            ['analyte' => 'hemoglobin', 'value' => 13.9, 'unit' => 'g/dL', 'status' => 'final'],
            self::SyntheticHbInterval,
        );

        $this->assertSame(139.0, $result['normalizedValue']);
        $this->assertSame('g/L', $result['canonicalUnit']);
        $this->assertSame(LabIntervalEvaluator::Below, $result['status']);
    }

    public function test_hematocrit_in_litre_per_litre_is_converted_to_percent(): void
    {
        $this->assertSame(42.0, $this->evaluator->normalize('hematocrit', 0.42, 'L/L'));
    }

    public function test_missing_unit_is_pending_verification(): void
    {
        $result = $this->evaluator->evaluate(
            ['analyte' => 'hemoglobin', 'value' => 150, 'unit' => null, 'status' => 'final'],
            self::SyntheticHbInterval,
        );

        $this->assertSame(LabIntervalEvaluator::PendingVerification, $result['status']);
    }

    public function test_preliminary_result_is_pending_verification(): void
    {
        $result = $this->evaluator->evaluate(
            ['analyte' => 'hemoglobin', 'value' => 150, 'unit' => 'g/L', 'status' => 'preliminary'],
            self::SyntheticHbInterval,
        );

        $this->assertSame(LabIntervalEvaluator::PendingVerification, $result['status']);
    }

    public function test_correction_under_verification_suspends_the_comparison(): void
    {
        $result = $this->evaluator->evaluate(
            ['analyte' => 'hemoglobin', 'value' => 150, 'unit' => 'g/L', 'status' => 'corrected', 'verified' => false],
            self::SyntheticHbInterval,
        );

        $this->assertSame(LabIntervalEvaluator::PendingVerification, $result['status']);
    }

    public function test_missing_interval_gives_reference_unavailable(): void
    {
        $result = $this->evaluator->evaluate(
            ['analyte' => 'hemoglobin', 'value' => 150, 'unit' => 'g/L', 'status' => 'final'],
            null,
        );

        $this->assertSame(LabIntervalEvaluator::ReferenceUnavailable, $result['status']);
    }

    public function test_open_interval_gives_reference_unavailable(): void
    {
        $result = $this->evaluator->evaluate(
            ['analyte' => 'hemoglobin', 'value' => 150, 'unit' => 'g/L', 'status' => 'final'],
            ['low' => 140, 'high' => null, 'unit' => 'g/L'],
        );

        $this->assertSame(LabIntervalEvaluator::ReferenceUnavailable, $result['status']);
    }

    public function test_interval_in_another_unit_is_normalised_before_comparison(): void
    {
        $result = $this->evaluator->evaluate(
            ['analyte' => 'hemoglobin', 'value' => 171, 'unit' => 'g/L', 'status' => 'final'],
            ['low' => 14.0, 'high' => 17.0, 'unit' => 'g/dL'],
        );

        $this->assertSame(LabIntervalEvaluator::Above, $result['status']);
    }
}
