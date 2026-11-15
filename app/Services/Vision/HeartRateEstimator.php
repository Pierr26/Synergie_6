<?php

namespace App\Services\Vision;

use InvalidArgumentException;

/**
 * Remote photoplethysmography (rPPG) from a webcam colour trace.
 *
 * The browser sends, for every frame, the mean R, G, B values of the face
 * region and a timestamp — never the video itself. This class applies the
 * POS projection (Wang et al., IEEE TBME 2017), then finds the dominant
 * frequency between 42 and 180 bpm with a Hann-windowed DFT.
 *
 * The estimate is a non-validated method: callers must store it as its own
 * series (method "webcam_rppg") with quality "to_verify".
 */
final class HeartRateEstimator
{
    public const float MinHz = 0.7;

    public const float MaxHz = 3.0;

    public const int MinDurationSeconds = 15;

    public const int MinFps = 10;

    private const float PosWindowSeconds = 1.6;

    private const float FrequencyStepHz = 0.005;

    private const float PeakHalfWidthHz = 0.1;

    /**
     * @param  list<array{0: float|int, 1: float|int, 2: float|int, 3: float|int}>  $samples  [timestampMs, r, g, b]
     * @return array{bpm: ?float, snrDb: float, signalQuality: string, durationSeconds: float, sampleRateHz: float, samples: int, issues: list<string>}
     */
    public function estimate(array $samples): array
    {
        if (count($samples) < 2) {
            throw new InvalidArgumentException('At least two samples are required.');
        }

        usort($samples, fn (array $a, array $b): int => $a[0] <=> $b[0]);

        $duration = ($samples[count($samples) - 1][0] - $samples[0][0]) / 1000;
        $fps = $duration > 0 ? (count($samples) - 1) / $duration : 0.0;
        $issues = [];

        if ($duration < self::MinDurationSeconds) {
            $issues[] = 'recording_too_short';
        }

        if ($fps < self::MinFps) {
            $issues[] = 'frame_rate_too_low';
        }

        if ($issues !== []) {
            return $this->result(null, 0.0, 'poor', $duration, $fps, count($samples), $issues);
        }

        $sampleRate = min(30.0, round($fps));
        [$red, $green, $blue] = $this->resample($samples, $sampleRate);

        if ($this->coefficientOfVariation($green) > 0.08) {
            $issues[] = 'unstable_lighting_or_motion';
        }

        $pulse = $this->posSignal($red, $green, $blue, $sampleRate);
        $spectrum = $this->spectrum($pulse, $sampleRate);

        $peakHz = $this->peakFrequency($spectrum);
        $snr = $peakHz === null ? 0.0 : $this->signalToNoise($spectrum, $peakHz);

        $quality = match (true) {
            $issues !== [] || $snr < 0.0 => 'poor',
            $snr < 3.0 => 'fair',
            default => 'good',
        };

        if ($quality === 'poor') {
            $issues[] = 'weak_pulse_signal';
        }

        $bpm = $quality === 'poor' || $peakHz === null ? null : round($peakHz * 60, 1);

        return $this->result($bpm, round($snr, 2), $quality, $duration, $sampleRate, count($samples), array_values(array_unique($issues)));
    }

    /**
     * Linear interpolation of the three channels onto a uniform time grid.
     *
     * @param  list<array{0: float|int, 1: float|int, 2: float|int, 3: float|int}>  $samples
     * @return array{0: list<float>, 1: list<float>, 2: list<float>}
     */
    private function resample(array $samples, float $sampleRate): array
    {
        $start = (float) $samples[0][0];
        $end = (float) $samples[count($samples) - 1][0];
        $stepMs = 1000 / $sampleRate;
        $channels = [[], [], []];
        $cursor = 0;

        for ($time = $start; $time <= $end; $time += $stepMs) {
            while ($cursor < count($samples) - 2 && $samples[$cursor + 1][0] < $time) {
                $cursor++;
            }

            $left = $samples[$cursor];
            $right = $samples[$cursor + 1];
            $span = $right[0] - $left[0];
            $ratio = $span > 0 ? ($time - $left[0]) / $span : 0.0;

            for ($channel = 0; $channel < 3; $channel++) {
                $channels[$channel][] = $left[$channel + 1] + ($right[$channel + 1] - $left[$channel + 1]) * $ratio;
            }
        }

        return $channels;
    }

    /**
     * Plane-Orthogonal-to-Skin projection with overlap-add.
     *
     * @param  list<float>  $red
     * @param  list<float>  $green
     * @param  list<float>  $blue
     * @return list<float>
     */
    private function posSignal(array $red, array $green, array $blue, float $sampleRate): array
    {
        $length = count($green);
        $window = max(2, (int) round(self::PosWindowSeconds * $sampleRate));
        $pulse = array_fill(0, $length, 0.0);

        for ($end = $window; $end <= $length; $end++) {
            $start = $end - $window;
            $meanRed = $this->mean(array_slice($red, $start, $window));
            $meanGreen = $this->mean(array_slice($green, $start, $window));
            $meanBlue = $this->mean(array_slice($blue, $start, $window));

            if ($meanRed <= 0 || $meanGreen <= 0 || $meanBlue <= 0) {
                continue;
            }

            $first = [];
            $second = [];

            for ($index = $start; $index < $end; $index++) {
                $normalizedRed = $red[$index] / $meanRed;
                $normalizedGreen = $green[$index] / $meanGreen;
                $normalizedBlue = $blue[$index] / $meanBlue;
                $first[] = $normalizedGreen - $normalizedBlue;
                $second[] = $normalizedGreen + $normalizedBlue - 2 * $normalizedRed;
            }

            $secondDeviation = $this->standardDeviation($second);
            $alpha = $secondDeviation > 0 ? $this->standardDeviation($first) / $secondDeviation : 0.0;
            $combined = [];

            foreach ($first as $offset => $value) {
                $combined[] = $value + $alpha * $second[$offset];
            }

            $combinedMean = $this->mean($combined);

            foreach ($combined as $offset => $value) {
                $pulse[$start + $offset] += $value - $combinedMean;
            }
        }

        return $pulse;
    }

    /**
     * Power spectrum between 0.7 and 4.0 Hz (harmonic included), Hann window.
     *
     * @param  list<float>  $signal
     * @return array<string, float> frequency (Hz, as string key) => power
     */
    private function spectrum(array $signal, float $sampleRate): array
    {
        $count = count($signal);
        $mean = $this->mean($signal);
        $windowed = [];

        foreach ($signal as $index => $value) {
            $hann = 0.5 * (1 - cos(2 * M_PI * $index / max(1, $count - 1)));
            $windowed[] = ($value - $mean) * $hann;
        }

        $powers = [];

        for ($frequency = self::MinHz; $frequency <= 2 * self::MaxHz + 1e-9; $frequency += self::FrequencyStepHz) {
            $real = 0.0;
            $imaginary = 0.0;
            $omega = 2 * M_PI * $frequency / $sampleRate;

            foreach ($windowed as $index => $value) {
                $real += $value * cos($omega * $index);
                $imaginary -= $value * sin($omega * $index);
            }

            $powers[sprintf('%.3f', $frequency)] = $real * $real + $imaginary * $imaginary;
        }

        return $powers;
    }

    /**
     * @param  array<string, float>  $spectrum
     */
    private function peakFrequency(array $spectrum): ?float
    {
        $peakHz = null;
        $peakPower = -1.0;

        foreach ($spectrum as $frequency => $power) {
            if ((float) $frequency <= self::MaxHz && $power > $peakPower) {
                $peakHz = (float) $frequency;
                $peakPower = $power;
            }
        }

        return $peakHz;
    }

    /**
     * SNR in dB: power around the peak and its first harmonic versus the rest
     * of the band (de Haan & Jeanne, 2013). Only the 42–180 bpm band can host
     * the peak itself.
     *
     * @param  array<string, float>  $spectrum
     */
    private function signalToNoise(array $spectrum, float $peakHz): float
    {
        $signal = 0.0;
        $noise = 0.0;

        foreach ($spectrum as $frequency => $power) {
            $frequency = (float) $frequency;
            $nearPeak = abs($frequency - $peakHz) <= self::PeakHalfWidthHz || abs($frequency - 2 * $peakHz) <= self::PeakHalfWidthHz;

            if ($nearPeak) {
                $signal += $power;
            } else {
                $noise += $power;
            }
        }

        return $noise > 0 && $signal > 0 ? 10 * log10($signal / $noise) : -INF;
    }

    /**
     * @param  list<float>  $values
     */
    private function coefficientOfVariation(array $values): float
    {
        $mean = $this->mean($values);

        return $mean > 0 ? $this->standardDeviation($values) / $mean : INF;
    }

    /**
     * @param  list<float>  $values
     */
    private function mean(array $values): float
    {
        return $values === [] ? 0.0 : array_sum($values) / count($values);
    }

    /**
     * @param  list<float>  $values
     */
    private function standardDeviation(array $values): float
    {
        $mean = $this->mean($values);
        $sum = 0.0;

        foreach ($values as $value) {
            $sum += ($value - $mean) ** 2;
        }

        return $values === [] ? 0.0 : sqrt($sum / count($values));
    }

    /**
     * @param  list<string>  $issues
     * @return array{bpm: ?float, snrDb: float, signalQuality: string, durationSeconds: float, sampleRateHz: float, samples: int, issues: list<string>}
     */
    private function result(?float $bpm, float $snr, string $quality, float $duration, float $sampleRate, int $samples, array $issues): array
    {
        return [
            'bpm' => $bpm,
            'snrDb' => is_finite($snr) ? $snr : -99.0,
            'signalQuality' => $quality,
            'durationSeconds' => round($duration, 2),
            'sampleRateHz' => round($sampleRate, 2),
            'samples' => $samples,
            'issues' => $issues,
        ];
    }
}
