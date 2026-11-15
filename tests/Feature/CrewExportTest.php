<?php

namespace Tests\Feature;

use App\Services\Demo\DemoScenario;
use Tests\TestCase;

class CrewExportTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->freshMongoDatabase();
        $this->artisan('migrate', ['--force' => true])->assertSuccessful();
        app(DemoScenario::class)->install();
    }

    public function test_csv_keeps_unit_method_quality_and_source(): void
    {
        $response = $this->get(route('api.v1.workspaces.crew.export', ['demo', 'moreau', 'format' => 'csv']))->assertOk();

        $response->assertHeader('Content-Type', 'text/csv; charset=UTF-8');
        $lines = array_map('str_getcsv', array_filter(explode("\n", $response->getContent())));
        $header = array_shift($lines);
        $rows = array_map(fn (array $line): array => array_combine($header, $line), $lines);

        $bloodPressure = collect($rows)->firstWhere('variable', 'blood_pressure');
        $this->assertSame(['118', '76', 'mmHg', 'cuff_oscillometric', 'valid', 'simulated_crew_data'], [
            $bloodPressure['value'], $bloodPressure['value_2'], $bloodPressure['unit'], $bloodPressure['method'], $bloodPressure['quality'], $bloodPressure['source'],
        ]);
        $this->assertSame(2, collect($rows)->where('record_type', 'lab_result')->count());
    }

    public function test_matlab_sleep_csv_marks_the_baseline_window(): void
    {
        $content = $this->get(route('api.v1.workspaces.crew.export', ['demo', 'moreau', 'format' => 'matlab-sleep']))->assertOk()->getContent();
        $lines = array_map('str_getcsv', array_filter(explode("\n", $content)));

        $this->assertSame(['case_id', 'mission_day', 'sleep_minutes', 'method', 'quality', 'is_baseline'], $lines[0]);
        $this->assertCount(21, $lines);
        $this->assertSame(['demo-moreau', '122', '440', 'sleep_diary', 'valid', '1'], $lines[1]);
        $this->assertSame(['demo-moreau', '141', '324', 'sleep_diary', 'valid', '0'], $lines[20]);
    }

    public function test_json_export_is_filtered_by_period_and_workspace(): void
    {
        $export = $this->getJson(route('api.v1.workspaces.crew.export', ['demo', 'moreau', 'fromDay' => 140, 'toDay' => 141]))->assertOk()->json();

        $this->assertSame('Simulated crew data', $export['dataLabel']);
        $this->assertSame([140, 141], array_values(array_unique(array_column($export['observations'], 'missionDay'))));
        $this->assertSame([], $this->getJson(route('api.v1.workspaces.crew.export', ['explore', 'okafor']))->json('observations'));
        $this->getJson(route('api.v1.workspaces.crew.export', ['demo', 'haddad']))->assertUnprocessable();
    }
}
