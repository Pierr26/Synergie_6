<?php

namespace Tests\Feature;

use App\Services\Demo\DemoScenario;
use Illuminate\Support\Str;
use Tests\TestCase;

class SyncApiTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->freshMongoDatabase();
        $this->artisan('migrate', ['--force' => true])->assertSuccessful();
        app(DemoScenario::class)->install();
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function measurement(array $overrides = []): array
    {
        return array_replace([
            'observationId' => (string) Str::uuid(),
            'recordedBy' => 'moreau',
            'variable' => 'blood_pressure',
            'value' => ['systolic' => 118, 'diastolic' => 76],
            'unit' => 'mmHg',
            'method' => 'cuff_oscillometric',
            'device' => 'Cuff A',
            'observedAt' => '2026-11-08T06:40:00Z',
            'context' => ['atRest' => true, 'posture' => 'seated'],
        ], $overrides);
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function labResult(array $overrides = []): array
    {
        return array_replace([
            'resultId' => (string) Str::uuid(),
            'enteredBy' => 'haddad',
            'analyte' => 'hemoglobin',
            'value' => 139,
            'unit' => 'g/L',
            'specimen' => 'venous_blood',
            'method' => 'point_of_care_analyzer',
            'collectedAt' => '2026-11-08T06:30:00Z',
            'analyzedAt' => '2026-11-08T06:55:00Z',
            'status' => 'final',
        ], $overrides);
    }

    public function test_checkin_requires_sleep_and_sleepiness_and_a_confirmed_zero(): void
    {
        $url = route('api.v1.workspaces.crew.checkins.upsert', ['demo', 'moreau', 142]);

        $this->putJson($url, ['status' => 'submitted', 'submittedBy' => 'moreau'])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['sleep', 'sleepiness']);

        $this->putJson($url, [
            'status' => 'submitted', 'submittedBy' => 'moreau',
            'sleep' => ['status' => 'recorded', 'minutes' => 0],
            'sleepiness' => ['status' => 'recorded', 'value' => 5],
        ])->assertUnprocessable()->assertJsonValidationErrors('sleep.zeroConfirmed');
    }

    public function test_not_recorded_fields_stay_visible_as_missing_observations(): void
    {
        $response = $this->putJson(route('api.v1.workspaces.crew.checkins.upsert', ['demo', 'moreau', 142]), [
            'status' => 'submitted', 'submittedBy' => 'moreau',
            'sleep' => ['status' => 'not_recorded'],
            'sleepiness' => ['status' => 'recorded', 'value' => 6],
            'symptoms' => ['answer' => 'skip'],
        ])->assertOk();

        $this->assertSame(['sleep', 'symptoms'], $response->json('data.unavailableFields'));
        $sleep = collect($response->json('observations'))->firstWhere('variable', 'sleep_duration');
        $this->assertNull($sleep['value']);
        $this->assertSame('missing', $sleep['quality']);

        $this->getJson(route('api.v1.workspaces.crew.checkins.show', ['demo', 'moreau', 142]))
            ->assertOk()
            ->assertJsonPath('data.status', 'submitted');
    }

    public function test_behavioral_fields_are_optional_and_saved_as_versioned_observations(): void
    {
        $response = $this->putJson(route('api.v1.workspaces.crew.checkins.upsert', ['demo', 'moreau', 142]), [
            'status' => 'submitted',
            'submittedBy' => 'moreau',
            'sleep' => ['status' => 'recorded', 'minutes' => 312],
            'sleepiness' => ['status' => 'recorded', 'value' => 8],
            'fatigue' => ['status' => 'recorded', 'value' => 4],
            'stress' => ['status' => 'not_recorded'],
            'perceivedIsolation' => ['status' => 'recorded', 'value' => 2],
            'workload' => ['status' => 'recorded', 'value' => 5],
        ])->assertOk();

        $observations = collect($response->json('observations'));

        $this->assertSame(4, $observations->whereIn('variable', [
            'fatigue', 'stress', 'perceived_isolation', 'perceived_workload',
        ])->count());
        $this->assertSame('missing', $observations->firstWhere('variable', 'stress')['quality']);
        $this->assertSame(5, $observations->firstWhere('variable', 'perceived_workload')['value']);
    }

    public function test_draft_keeps_the_reminder_open_and_future_days_are_refused(): void
    {
        $this->postJson(route('api.v1.workspaces.clock.update', 'demo'), ['minutes' => 5])->assertOk();

        $this->putJson(route('api.v1.workspaces.crew.checkins.upsert', ['demo', 'moreau', 142]), [
            'status' => 'draft', 'submittedBy' => 'moreau',
            'sleep' => ['status' => 'recorded', 'minutes' => 312],
            'sleepiness' => ['status' => 'not_recorded'],
        ])->assertOk()->assertJsonPath('data.status', 'draft');

        $this->assertSame('due', $this->getJson(route('api.v1.workspaces.crew.plan', ['demo', 'moreau']))->json('data.today.state'));
        $this->assertSame(0, $this->mongoCollection('observations')->countDocuments(['missionDay' => 142]));

        $this->putJson(route('api.v1.workspaces.crew.checkins.upsert', ['demo', 'moreau', 143]), [
            'status' => 'submitted', 'submittedBy' => 'moreau',
            'sleep' => ['status' => 'recorded', 'minutes' => 400],
            'sleepiness' => ['status' => 'recorded', 'value' => 3],
        ])->assertConflict();
    }

    public function test_measurement_replay_is_idempotent_and_correction_adds_a_version(): void
    {
        $url = route('api.v1.workspaces.crew.observations.store', ['demo', 'moreau']);
        $payload = $this->measurement();

        $created = $this->postJson($url, $payload)->assertCreated();
        $this->assertSame('valid', $created->json('data.quality'));
        $this->postJson($url, $payload)->assertOk()->assertJsonPath('data.version', 1);

        $lineageId = $payload['observationId'];
        $correction = array_diff_key($this->measurement(['value' => ['systolic' => 121, 'diastolic' => 78], 'reason' => 'Typo']), ['observationId' => true]);

        $this->postJson(route('api.v1.workspaces.crew.observations.correct', ['demo', 'moreau', $lineageId]), $correction)
            ->assertCreated()
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.correctionReason', 'Typo');

        $history = $this->getJson(route('api.v1.workspaces.crew.observations.history', ['demo', 'moreau', $lineageId]))->json('data');
        $this->assertSame(['superseded', 'current'], array_column($history, 'status'));
        $this->assertSame(118, $history[0]['value']['systolic']);
    }

    public function test_incoherent_readings_are_kept_and_flagged_for_verification(): void
    {
        $url = route('api.v1.workspaces.crew.observations.store', ['demo', 'moreau']);

        $this->postJson($url, $this->measurement(['value' => ['systolic' => 80, 'diastolic' => 90]]))
            ->assertCreated()
            ->assertJsonPath('data.quality', 'to_verify')
            ->assertJsonPath('data.qualityFlags', ['systolic_not_above_diastolic']);

        $this->postJson($url, $this->measurement(['variable' => 'temperature', 'value' => 36.7, 'unit' => 'Cel', 'method' => 'digital_thermometer', 'context' => []]))
            ->assertCreated()
            ->assertJsonPath('data.qualityFlags', ['site_unknown']);

        $this->postJson($url, $this->measurement(['variable' => 'spo2', 'value' => 101, 'unit' => '%', 'method' => 'pulse_oximeter']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('value');

        $this->postJson($url, $this->measurement(['variable' => 'glucose', 'value' => 92, 'unit' => 'mmHg', 'method' => 'glucometer']))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('unit');
    }

    public function test_incomparable_series_are_kept_apart(): void
    {
        $url = route('api.v1.workspaces.crew.observations.store', ['demo', 'sato']);
        $base = ['recordedBy' => 'sato', 'observedAt' => '2026-11-08T06:45:00Z'];

        $this->postJson($url, $this->measurement([...$base, 'variable' => 'temperature', 'value' => 36.7, 'unit' => 'Cel', 'method' => 'digital_thermometer', 'context' => ['site' => 'oral']]))->assertCreated();
        $this->postJson($url, $this->measurement([...$base, 'variable' => 'temperature', 'value' => 34.1, 'unit' => 'Cel', 'method' => 'skin_sensor', 'context' => ['site' => 'skin']]))->assertCreated();
        $this->postJson($url, $this->measurement([...$base, 'variable' => 'glucose', 'value' => 92, 'unit' => 'mg/dL', 'method' => 'glucometer', 'context' => ['specimen' => 'capillary', 'context' => 'fasting']]))->assertCreated();
        $this->postJson($url, $this->measurement([...$base, 'variable' => 'glucose', 'value' => 95, 'unit' => 'mg/dL', 'method' => 'laboratory', 'context' => ['specimen' => 'plasma', 'context' => 'fasting']]))->assertCreated();

        $series = $this->getJson(route('api.v1.workspaces.crew.observations.index', ['demo', 'sato']))->json('series');
        $temperatureSeries = array_filter(array_keys($series), fn (string $key): bool => str_starts_with($key, 'temperature|'));
        $glucoseSeries = array_filter(array_keys($series), fn (string $key): bool => str_starts_with($key, 'glucose|'));

        $this->assertCount(2, $temperatureSeries);
        $this->assertCount(2, $glucoseSeries);
    }

    public function test_telemetry_observations_keep_sensor_provenance_and_separate_assignments(): void
    {
        $url = route('api.v1.workspaces.crew.observations.store', ['demo', 'moreau']);

        $base = [
            'recordedBy' => 'moreau',
            'observedAt' => '2026-11-08T07:00:00Z',
            'method' => 'telemetry',
        ];

        $this->postJson($url, $this->measurement([...$base,
            'variable' => 'radiation_dose_rate',
            'value' => 0.12,
            'unit' => 'uGy/h',
            'context' => ['sensorId' => 'CAD-MOREAU-01', 'sensorType' => 'Crew Active Dosimeter', 'assignment' => 'moreau', 'source' => 'simulated-cad', 'simulated' => true],
        ]))->assertCreated()->assertJsonPath('data.quality', 'valid');

        $this->postJson($url, $this->measurement([...$base,
            'variable' => 'radiation_absorbed_dose',
            'value' => 1.8,
            'unit' => 'mGy',
            'context' => ['sensorId' => 'HERA-MODULE-01', 'sensorType' => 'HERA', 'assignment' => 'module', 'source' => 'simulated-hera', 'simulated' => true],
        ]))->assertCreated()->assertJsonPath('data.quality', 'valid');

        $missingSource = $this->postJson($url, $this->measurement([...$base,
            'variable' => 'radiation_dose_rate',
            'value' => 0.3,
            'unit' => 'uGy/h',
            'context' => ['sensorId' => 'CAD-MOREAU-01'],
        ]))->assertCreated();

        $this->assertSame('to_verify', $missingSource->json('data.quality'));
        $this->assertContains('source_missing', $missingSource->json('data.qualityFlags'));

        $series = $this->getJson(route('api.v1.workspaces.crew.observations.index', ['demo', 'moreau']))->json('series');
        $radiationSeries = array_filter(array_keys($series), fn (string $key): bool => str_starts_with($key, 'radiation_'));

        $this->assertCount(3, $radiationSeries);
    }

    public function test_measurements_do_not_leak_between_workspaces(): void
    {
        $this->postJson(route('api.v1.workspaces.crew.observations.store', ['explore', 'okafor']), $this->measurement(['recordedBy' => 'okafor']))->assertCreated();

        $demo = $this->getJson(route('api.v1.workspaces.crew.observations.index', ['demo', 'moreau']).'?variable=blood_pressure')->json('data');
        $explore = $this->getJson(route('api.v1.workspaces.crew.observations.index', ['explore', 'okafor']).'?variable=blood_pressure')->json('data');

        $this->assertCount(1, $explore);
        $this->assertNotContains($explore[0]['id'], array_column($demo, 'id'));
    }

    public function test_workspace_actor_header_can_be_required_server_side(): void
    {
        config(['hexta.identity.required' => true]);
        $url = route('api.v1.workspaces.crew.observations.index', ['demo', 'moreau']);

        $this->getJson($url)->assertUnauthorized();
        $this->getJson($url, ['X-Hexta-Actor' => 'unknown'])->assertForbidden();
        $this->getJson($url, ['X-Hexta-Actor' => 'haddad'])->assertOk();
    }

    public function test_hemoglobin_bounds_and_unit_conversion_from_the_workspace_interval(): void
    {
        $url = route('api.v1.workspaces.crew.lab-results.store', ['demo', 'moreau']);

        foreach ([[139, 'below'], [140, 'within'], [170, 'within'], [171, 'above']] as [$value, $status]) {
            $this->postJson($url, $this->labResult(['value' => $value]))
                ->assertCreated()
                ->assertJsonPath('data.evaluation.status', $status)
                ->assertJsonPath('data.evaluation.intervalOrigin', 'workspace_policy');
        }

        $sato = $this->getJson(route('api.v1.workspaces.crew.lab-results.index', ['demo', 'sato']))->json('data');
        $hemoglobin = collect($sato)->firstWhere('analyte', 'hemoglobin');
        $hematocrit = collect($sato)->firstWhere('analyte', 'hematocrit');

        $this->assertEqualsWithDelta(139.0, $hemoglobin['evaluation']['normalizedValue'], 1e-9);
        $this->assertSame('below', $hemoglobin['evaluation']['status']);
        $this->assertEqualsWithDelta(42.0, $hematocrit['evaluation']['normalizedValue'], 1e-9);
        $this->assertSame(25, $hemoglobin['processingDelayMinutes']);
    }

    public function test_lab_entry_is_reserved_to_the_cmo_and_flags_incomplete_results(): void
    {
        $url = route('api.v1.workspaces.crew.lab-results.store', ['demo', 'moreau']);

        $this->postJson($url, $this->labResult(['enteredBy' => 'moreau']))->assertUnprocessable()->assertJsonValidationErrors('enteredBy');

        $this->postJson($url, $this->labResult(['status' => 'preliminary']))
            ->assertCreated()
            ->assertJsonPath('data.evaluation.status', 'pending_verification');

        $this->postJson($url, $this->labResult(['unit' => null, 'collectedAt' => null]))
            ->assertCreated()
            ->assertJsonPath('data.evaluation.status', 'pending_verification')
            ->assertJsonPath('data.reportable', false)
            ->assertJsonPath('data.reviewFlags', ['collection_time_missing', 'unit_missing']);
    }

    public function test_lab_correction_suspends_comparison_until_verified(): void
    {
        $payload = $this->labResult(['value' => 150]);
        $this->postJson(route('api.v1.workspaces.crew.lab-results.store', ['demo', 'moreau']), $payload)->assertCreated();

        $this->postJson(route('api.v1.workspaces.crew.lab-results.store', ['demo', 'moreau']), [...$payload, 'value' => 151])->assertConflict();

        $this->postJson(route('api.v1.workspaces.lab-results.correct', ['demo', $payload['resultId']]), [
            'correctedBy' => 'haddad', 'reason' => 'Transcription error', 'value' => 171,
        ])->assertCreated()
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.status', 'corrected')
            ->assertJsonPath('data.evaluation.status', 'pending_verification');

        $this->postJson(route('api.v1.workspaces.lab-results.verify', ['demo', $payload['resultId']]), ['verifiedBy' => 'haddad'])
            ->assertOk()
            ->assertJsonPath('data.evaluation.status', 'above')
            ->assertJsonPath('data.verifiedBy', 'haddad');

        $versions = $this->getJson(route('api.v1.workspaces.lab-results.history', ['demo', $payload['resultId']]))->json('data');
        $this->assertSame([150, 171], array_column($versions, 'value'));
    }
}
