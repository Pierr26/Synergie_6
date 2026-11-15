<?php

namespace App\Services\Rules;

/**
 * SLEEP-001 v1 — demo rule of the guided scenario (cahier des charges p.11).
 *
 * Fires when three consecutive mission days each carry one valid sleep-diary
 * observation strictly below the threshold (360 min). A value >= threshold,
 * a missing day, an invalid reading or a non-comparable method breaks the run.
 * A fourth admissible night extends the same episode instead of creating a
 * new alert. At most one effective observation per day is counted: the
 * highest version wins.
 */
final class SleepRule
{
    public function __construct(
        public readonly string $ruleId = 'SLEEP-001',
        public readonly int $version = 1,
        public readonly int $thresholdMinutes = 360,
        public readonly int $consecutiveDays = 3,
        public readonly string $method = 'sleep_diary',
        public readonly int $baselineMinNights = 7,
    ) {}

    public static function fromConfig(): self
    {
        $config = config('hexta.sleep_rule');

        return new self(
            ruleId: $config['id'],
            version: $config['version'],
            thresholdMinutes: $config['threshold_minutes'],
            consecutiveDays: $config['consecutive_days'],
            method: $config['method'],
            baselineMinNights: $config['baseline_min_nights'],
        );
    }

    /**
     * @param  list<array{missionDay: int, minutes: int|float|null, method: string, quality: string, observationId: string, version?: int}>  $observations
     * @return list<array{ruleId: string, ruleVersion: int, startDay: int, triggeredOnDay: int, lastDay: int, evidence: list<array{missionDay: int, minutes: int|float, observationId: string}>}>
     */
    public function episodes(array $observations, ?int $asOfDay = null): array
    {
        $effective = $this->effectivePerDay($observations, $asOfDay);

        if ($effective === []) {
            return [];
        }

        $episodes = [];
        $run = [];
        $firstDay = min(array_keys($effective));
        $lastDay = max(array_keys($effective));

        for ($day = $firstDay; $day <= $lastDay + 1; $day++) {
            $observation = $effective[$day] ?? null;

            if ($observation !== null && $this->isAdmissibleShortNight($observation)) {
                $run[] = [
                    'missionDay' => $day,
                    'minutes' => $observation['minutes'],
                    'observationId' => $observation['observationId'],
                ];

                continue;
            }

            if (count($run) >= $this->consecutiveDays) {
                $episodes[] = $this->episodeFromRun($run);
            }

            $run = [];
        }

        return $episodes;
    }

    /**
     * Personal reference: median of valid diary nights in a window.
     *
     * @param  list<array{missionDay: int, minutes: int|float|null, method: string, quality: string, observationId: string, version?: int}>  $observations
     * @return array{median: float, nights: int, method: string, fromDay: int, toDay: int}|null
     */
    public function personalBaseline(array $observations, int $fromDay, int $toDay): ?array
    {
        $values = [];

        foreach ($this->effectivePerDay($observations, $toDay) as $day => $observation) {
            if ($day >= $fromDay && $this->isComparable($observation)) {
                $values[] = (float) $observation['minutes'];
            }
        }

        if (count($values) < $this->baselineMinNights) {
            return null;
        }

        sort($values);
        $count = count($values);
        $middle = intdiv($count, 2);
        $median = $count % 2 === 0 ? ($values[$middle - 1] + $values[$middle]) / 2 : $values[$middle];

        return [
            'median' => $median,
            'nights' => $count,
            'method' => $this->method,
            'fromDay' => $fromDay,
            'toDay' => $toDay,
        ];
    }

    /**
     * @param  array{minutes: int|float|null, method: string, quality: string}  $observation
     */
    private function isComparable(array $observation): bool
    {
        return $observation['method'] === $this->method
            && $observation['quality'] === 'valid'
            && is_numeric($observation['minutes'])
            && $observation['minutes'] >= 0
            && $observation['minutes'] <= 1440;
    }

    /**
     * @param  array{minutes: int|float|null, method: string, quality: string}  $observation
     */
    private function isAdmissibleShortNight(array $observation): bool
    {
        return $this->isComparable($observation) && $observation['minutes'] < $this->thresholdMinutes;
    }

    /**
     * Keeps, for each mission day, the highest version of the diary reading.
     * Readings from another method are ignored here: they are a distinct series.
     *
     * @param  list<array{missionDay: int, minutes: int|float|null, method: string, quality: string, observationId: string, version?: int}>  $observations
     * @return array<int, array{missionDay: int, minutes: int|float|null, method: string, quality: string, observationId: string, version?: int}>
     */
    private function effectivePerDay(array $observations, ?int $asOfDay): array
    {
        $effective = [];

        foreach ($observations as $observation) {
            $day = (int) $observation['missionDay'];

            if ($observation['method'] !== $this->method || ($asOfDay !== null && $day > $asOfDay)) {
                continue;
            }

            $current = $effective[$day] ?? null;

            if ($current === null || ($observation['version'] ?? 1) > ($current['version'] ?? 1)) {
                $effective[$day] = $observation;
            }
        }

        ksort($effective);

        return $effective;
    }

    /**
     * @param  list<array{missionDay: int, minutes: int|float, observationId: string}>  $run
     * @return array{ruleId: string, ruleVersion: int, startDay: int, triggeredOnDay: int, lastDay: int, evidence: list<array{missionDay: int, minutes: int|float, observationId: string}>}
     */
    private function episodeFromRun(array $run): array
    {
        return [
            'ruleId' => $this->ruleId,
            'ruleVersion' => $this->version,
            'startDay' => $run[0]['missionDay'],
            'triggeredOnDay' => $run[$this->consecutiveDays - 1]['missionDay'],
            'lastDay' => $run[count($run) - 1]['missionDay'],
            'evidence' => $run,
        ];
    }
}
