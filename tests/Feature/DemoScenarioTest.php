<?php

namespace Tests\Feature;

use App\Services\Demo\DemoScenario;
use App\Services\Rules\SleepRule;
use Tests\TestCase;

class DemoScenarioTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->freshMongoDatabase();
    }

    /**
     * @return list<array{missionDay: int, minutes: int, method: string, quality: string, observationId: string, version: int}>
     */
    private function sleepSeries(string $workspaceId, string $crewId): array
    {
        $cursor = $this->mongoCollection('observations')->find(
            ['workspaceId' => $workspaceId, 'subjectId' => $crewId, 'variable' => 'sleep_duration'],
            ['sort' => ['missionDay' => 1]],
        );

        $series = [];

        foreach ($cursor as $observation) {
            $series[] = [
                'missionDay' => $observation['missionDay'],
                'minutes' => $observation['value'],
                'method' => $observation['method'],
                'quality' => $observation['quality'],
                'observationId' => $observation['_id'],
                'version' => $observation['version'],
            ];
        }

        return $series;
    }

    public function test_installs_two_isolated_workspaces(): void
    {
        app(DemoScenario::class)->install();

        $demo = $this->mongoCollection('workspaces')->findOne(['_id' => 'demo']);
        $explore = $this->mongoCollection('workspaces')->findOne(['_id' => 'explore']);

        $this->assertSame('controlled', $demo['clock']['type']);
        $this->assertSame('2026-11-08T06:59:00+00:00', $demo['clock']['current']->toDateTime()->format(DATE_ATOM));
        $this->assertSame('SLEEP-001', $demo['policy']['sleepRule']['id']);
        $this->assertNull($explore['policy']['sleepRule']);
        $this->assertSame('No mission rule configured', $explore['policy']['sleepRuleMessage']);
        $this->assertSame(0, $this->mongoCollection('observations')->countDocuments(['workspaceId' => 'explore']));
    }

    public function test_seeded_demo_matches_guided_scenario_before_day_142_entry(): void
    {
        app(DemoScenario::class)->install();
        $rule = app(SleepRule::class);
        $series = $this->sleepSeries('demo', 'moreau');

        $this->assertSame(438.5, $rule->personalBaseline($series, 122, 135)['median']);
        $this->assertSame([], $rule->episodes($series, asOfDay: 138));
        $this->assertSame([], $rule->episodes($series, asOfDay: 141));

        $series[] = ['missionDay' => 142, 'minutes' => 312, 'method' => 'sleep_diary', 'quality' => 'valid', 'observationId' => 'live-J142', 'version' => 1];
        $episodes = $rule->episodes($series, asOfDay: 142);

        $this->assertCount(1, $episodes);
        $this->assertSame([336, 324, 312], array_column($episodes[0]['evidence'], 'minutes'));
    }

    public function test_demo_reset_leaves_explore_records_untouched(): void
    {
        $scenario = app(DemoScenario::class);
        $scenario->install();

        $this->mongoCollection('observations')->insertOne(['_id' => 'explore-note', 'workspaceId' => 'explore', 'subjectId' => 'sato', 'variable' => 'mood', 'value' => 4]);
        $this->mongoCollection('observations')->insertOne(['_id' => 'demo-extra', 'workspaceId' => 'demo', 'subjectId' => 'moreau', 'variable' => 'mood', 'value' => 2]);

        $scenario->resetDemo();

        $this->assertNotNull($this->mongoCollection('observations')->findOne(['_id' => 'explore-note']));
        $this->assertNull($this->mongoCollection('observations')->findOne(['_id' => 'demo-extra']));
        $this->assertSame(4, $this->mongoCollection('crew_members')->countDocuments(['workspaceId' => 'explore']));
    }

    public function test_lab_records_are_separated_by_crew_member(): void
    {
        app(DemoScenario::class)->install();

        $sato = $this->mongoCollection('lab_results')->findOne(['workspaceId' => 'demo', 'subjectId' => 'sato', 'analyte' => 'hemoglobin']);
        $moreau = $this->mongoCollection('lab_results')->findOne(['workspaceId' => 'demo', 'subjectId' => 'moreau', 'analyte' => 'hemoglobin']);

        $this->assertSame('g/dL', $sato['unit']);
        $this->assertSame(13.9, $sato['value']);
        $this->assertSame('g/L', $moreau['unit']);
        $this->assertSame('718-7', $moreau['loinc']);
    }
}
