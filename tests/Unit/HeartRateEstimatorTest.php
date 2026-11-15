<?php

namespace Tests\Unit;

use App\Services\Vision\HeartRateEstimator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class HeartRateEstimatorTest extends TestCase
{
    /**
     * Synthetic face trace: a pulse at $bpm, slow illumination drift,
     * deterministic noise and irregular frame timing (~30 fps).
     *
     * @return list<array{0: float, 1: float, 2: float, 3: float}>
     */
    private function syntheticTrace(float $bpm, float $seconds = 20.0, float $pulseAmplitude = 0.6, float $noiseAmplitude = 0.15): array
    {
        mt_srand(42);
        $samples = [];
        $time = 0.0;

        while ($time <= $seconds * 1000) {
            $t = $time / 1000;
            $pulse = sin(2 * M_PI * ($bpm / 60) * $t);
            $drift = 1.5 * sin(2 * M_PI * 0.05 * $t);
            $noise = fn (): float => (mt_rand() / mt_getrandmax() - 0.5) * 2 * $noiseAmplitude;

            $samples[] = [
                $time,
                150 + $drift + 0.35 * $pulseAmplitude * $pulse + $noise(),
                120 + $drift + $pulseAmplitude * $pulse + $noise(),
                100 + $drift + 0.25 * $pulseAmplitude * $pulse + $noise(),
            ];

            $time += 33.3 + (mt_rand(0, 40) - 20) / 10;
        }

        return $samples;
    }

    /**
     * @return array<string, array{float}>
     */
    public static function heartRateProvider(): array
    {
        return [
            'bradycardic 52 bpm' => [52.0],
            'resting 72 bpm' => [72.0],
            'elevated 110 bpm' => [110.0],
        ];
    }

    #[DataProvider('heartRateProvider')]
    public function test_recovers_the_pulse_frequency(float $bpm): void
    {
        $result = (new HeartRateEstimator)->estimate($this->syntheticTrace($bpm));

        $this->assertNotNull($result['bpm']);
        $this->assertEqualsWithDelta($bpm, $result['bpm'], 2.0);
        $this->assertSame('good', $result['signalQuality']);
        $this->assertGreaterThan(3.0, $result['snrDb']);
    }

    public function test_noise_only_trace_gives_no_value(): void
    {
        $result = (new HeartRateEstimator)->estimate($this->syntheticTrace(72.0, pulseAmplitude: 0.0, noiseAmplitude: 0.6));

        $this->assertNotSame('good', $result['signalQuality']);
    }

    public function test_short_recording_is_rejected(): void
    {
        $result = (new HeartRateEstimator)->estimate($this->syntheticTrace(72.0, seconds: 8.0));

        $this->assertNull($result['bpm']);
        $this->assertSame('poor', $result['signalQuality']);
        $this->assertContains('recording_too_short', $result['issues']);
    }

    public function test_low_frame_rate_is_rejected(): void
    {
        $samples = array_values(array_filter($this->syntheticTrace(72.0), fn (array $sample, int $index): bool => $index % 5 === 0, ARRAY_FILTER_USE_BOTH));

        $result = (new HeartRateEstimator)->estimate($samples);

        $this->assertNull($result['bpm']);
        $this->assertContains('frame_rate_too_low', $result['issues']);
    }
}
