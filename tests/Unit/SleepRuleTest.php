<?php

namespace Tests\Unit;

use App\Services\Rules\SleepRule;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class SleepRuleTest extends TestCase
{
    private SleepRule $rule;

    protected function setUp(): void
    {
        parent::setUp();

        $this->rule = new SleepRule;
    }

    /**
     * Guided scenario J136-J142 (cahier des charges p.18).
     *
     * @return list<array{missionDay: int, minutes: int, method: string, quality: string, observationId: string}>
     */
    private function guidedScenario(): array
    {
        $minutes = [136 => 450, 137 => 432, 138 => 384, 139 => 366, 140 => 336, 141 => 324, 142 => 312];

        return array_map(
            fn (int $day, int $value): array => $this->diary($day, $value),
            array_keys($minutes),
            $minutes,
        );
    }

    /**
     * @return array{missionDay: int, minutes: int|null, method: string, quality: string, observationId: string, version: int}
     */
    private function diary(int $day, ?int $minutes, string $quality = 'valid', string $method = 'sleep_diary', int $version = 1): array
    {
        return [
            'missionDay' => $day,
            'minutes' => $minutes,
            'method' => $method,
            'quality' => $quality,
            'observationId' => "obs-{$day}-v{$version}-{$method}",
            'version' => $version,
        ];
    }

    public function test_no_alert_on_day_138(): void
    {
        $this->assertSame([], $this->rule->episodes($this->guidedScenario(), asOfDay: 138));
    }

    public function test_no_alert_on_day_141_with_only_two_short_nights(): void
    {
        $this->assertSame([], $this->rule->episodes($this->guidedScenario(), asOfDay: 141));
    }

    public function test_day_142_entry_triggers_alert_with_three_observations(): void
    {
        $episodes = $this->rule->episodes($this->guidedScenario(), asOfDay: 142);

        $this->assertCount(1, $episodes);
        $this->assertSame('SLEEP-001', $episodes[0]['ruleId']);
        $this->assertSame(1, $episodes[0]['ruleVersion']);
        $this->assertSame(140, $episodes[0]['startDay']);
        $this->assertSame(142, $episodes[0]['triggeredOnDay']);
        $this->assertSame([336, 324, 312], array_column($episodes[0]['evidence'], 'minutes'));
    }

    public function test_fourth_admissible_night_extends_the_same_episode(): void
    {
        $observations = [...$this->guidedScenario(), $this->diary(143, 300)];

        $episodes = $this->rule->episodes($observations);

        $this->assertCount(1, $episodes);
        $this->assertSame(140, $episodes[0]['startDay']);
        $this->assertSame(143, $episodes[0]['lastDay']);
        $this->assertCount(4, $episodes[0]['evidence']);
    }

    /**
     * @return array<string, array{int, int}>
     */
    public static function boundaryProvider(): array
    {
        return [
            '359 min counts as short night' => [359, 1],
            '360 min breaks the series' => [360, 0],
        ];
    }

    #[DataProvider('boundaryProvider')]
    public function test_threshold_is_strict(int $thirdNight, int $expectedEpisodes): void
    {
        $observations = [$this->diary(10, 300), $this->diary(11, 300), $this->diary(12, $thirdNight)];

        $this->assertCount($expectedEpisodes, $this->rule->episodes($observations));
    }

    public function test_missing_day_breaks_the_series(): void
    {
        $observations = [$this->diary(10, 300), $this->diary(11, 300), $this->diary(13, 300)];

        $this->assertSame([], $this->rule->episodes($observations));
    }

    public function test_invalid_reading_breaks_the_series(): void
    {
        $observations = [$this->diary(10, 300), $this->diary(11, 300, quality: 'invalid'), $this->diary(12, 300)];

        $this->assertSame([], $this->rule->episodes($observations));
    }

    public function test_sensor_only_day_is_not_comparable_with_diary(): void
    {
        $observations = [$this->diary(10, 300), $this->diary(11, 300, method: 'actigraphy'), $this->diary(12, 300)];

        $this->assertSame([], $this->rule->episodes($observations));
    }

    public function test_highest_version_of_a_night_is_the_only_one_counted(): void
    {
        $observations = [
            $this->diary(10, 300),
            $this->diary(11, 300),
            $this->diary(12, 300),
            $this->diary(12, 420, version: 2),
        ];

        $this->assertSame([], $this->rule->episodes($observations));
    }

    public function test_personal_baseline_median_is_438_5_minutes(): void
    {
        $reference = [440, 430, 445, 435, 438, 442, 436, 439, 443, 431, 441, 437, 434, 446];
        $observations = [];

        foreach ($reference as $offset => $minutes) {
            $observations[] = $this->diary(122 + $offset, $minutes);
        }

        $baseline = $this->rule->personalBaseline($observations, 122, 135);

        $this->assertSame(438.5, $baseline['median']);
        $this->assertSame(14, $baseline['nights']);
        $this->assertSame('sleep_diary', $baseline['method']);
    }

    public function test_personal_baseline_requires_seven_valid_nights(): void
    {
        $observations = array_map(fn (int $day): array => $this->diary($day, 430), range(122, 127));

        $this->assertNull($this->rule->personalBaseline($observations, 122, 135));
    }
}
