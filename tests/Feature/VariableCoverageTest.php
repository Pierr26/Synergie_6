<?php

namespace Tests\Feature;

use App\Services\Observations\ObservationRecorder;
use Tests\TestCase;

/**
 * Regression tests for variable coverage finalization (2026-11-14).
 *
 * Tests:
 * - wearStatus: not_worn handling (quality flags)
 * - PVT/Vigilance pathway (validation, quality, seriesKey)
 * - CO₂ ppm without absolutePressure (conversion_unavailable flag)
 * - New check-in fields backward compatibility
 * - Radiation dose rate time series
 */
class VariableCoverageTest extends TestCase
{
    /**
     * Test É5.1: wearStatus: not_worn with null value is valid.
     */
    public function test_actigraphy_not_worn_with_null_value_is_valid(): void
    {
        $recorder = app(ObservationRecorder::class);

        $quality = $recorder->assessQuality(
            'actigraphy_sleep_duration',
            null,
            'min',
            ['wearStatus' => 'not_worn', 'sensorId' => 'ACTI-001']
        );

        $this->assertEquals('missing', $quality['quality']);
        $this->assertContains('not_recorded', $quality['flags']);
        $this->assertNotContains('wear_status_unknown', $quality['flags']);
    }

    /**
     * Test É5.2: wearStatus: not_worn with value provided is flagged.
     */
    public function test_actigraphy_not_worn_with_value_is_flagged(): void
    {
        $recorder = app(ObservationRecorder::class);

        $quality = $recorder->assessQuality(
            'actigraphy_sleep_duration',
            420,
            'min',
            ['wearStatus' => 'not_worn', 'sensorId' => 'ACTI-001']
        );

        $this->assertEquals('to_verify', $quality['quality']);
        $this->assertContains('device_not_worn_but_value_provided', $quality['flags']);
    }

    /**
     * Test É5.3: wearStatus: worn with value is valid.
     */
    public function test_actigraphy_worn_with_value_is_valid(): void
    {
        $recorder = app(ObservationRecorder::class);

        $quality = $recorder->assessQuality(
            'actigraphy_sleep_duration',
            420,
            'min',
            ['wearStatus' => 'worn', 'sensorId' => 'ACTI-001']
        );

        $this->assertEquals('valid', $quality['quality']);
        $this->assertEmpty($quality['flags']);
    }

    /**
     * Test É5.4: wearStatus: unknown is flagged.
     */
    public function test_actigraphy_wear_status_unknown_is_flagged(): void
    {
        $recorder = app(ObservationRecorder::class);

        $quality = $recorder->assessQuality(
            'actigraphy_sleep_duration',
            420,
            'min',
            ['wearStatus' => 'unknown', 'sensorId' => 'ACTI-001']
        );

        $this->assertEquals('to_verify', $quality['quality']);
        $this->assertContains('wear_status_unknown', $quality['flags']);
    }

    /**
     * Test É6.1: PVT reaction time validation accepts ms unit.
     */
    public function test_pvt_accepts_ms_unit(): void
    {
        $response = $this->postJson('/api/v1/workspaces/demo/observations', [
            'observationId' => fake()->uuid(),
            'recordedBy' => 'moreau',
            'variable' => 'pvt_reaction_time',
            'unit' => 'ms',
            'value' => 285,
            'method' => 'pvt_protocol_v1',
            'observedAt' => now()->toIso8601String(),
            'context' => [
                'protocol' => 'PVT-192-10min',
                'testDuration' => 600000,
                'simulated' => true,
            ],
        ], ['X-Hexta-Actor' => json_encode(['crewId' => 'moreau', 'role' => 'astronaut'])]);

        $response->assertStatus(201);
        $response->assertJsonPath('data.variable', 'pvt_reaction_time');
        $response->assertJsonPath('data.unit', 'ms');
    }

    /**
     * Test É6.2: PVT without protocol is flagged.
     */
    public function test_pvt_without_protocol_is_flagged(): void
    {
        $recorder = app(ObservationRecorder::class);

        $quality = $recorder->assessQuality(
            'pvt_reaction_time',
            285,
            'ms',
            ['simulated' => true]
        );

        $this->assertEquals('to_verify', $quality['quality']);
        $this->assertContains('protocol_missing', $quality['flags']);
    }

    /**
     * Test É6.3: PVT with simulated=true is flagged.
     */
    public function test_pvt_simulated_data_is_flagged(): void
    {
        $recorder = app(ObservationRecorder::class);

        $quality = $recorder->assessQuality(
            'pvt_reaction_time',
            285,
            'ms',
            ['protocol' => 'PVT-192-10min', 'simulated' => true]
        );

        $this->assertEquals('to_verify', $quality['quality']);
        $this->assertContains('simulated_data', $quality['flags']);
    }

    /**
     * Test É6.4: PVT seriesKey separates by protocol and device.
     */
    public function test_pvt_series_key_separates_by_protocol(): void
    {
        $key1 = ObservationRecorder::seriesKey('pvt_reaction_time', 'pvt_protocol_v1', 'ms', [
            'protocol' => 'PVT-192-10min',
            'device' => 'Device A',
        ]);

        $key2 = ObservationRecorder::seriesKey('pvt_reaction_time', 'pvt_protocol_v1', 'ms', [
            'protocol' => 'PVT-192-5min',
            'device' => 'Device A',
        ]);

        $this->assertNotEquals($key1, $key2);
        $this->assertStringContainsString('protocol=PVT-192-10min', $key1);
        $this->assertStringContainsString('protocol=PVT-192-5min', $key2);
    }

    /**
     * Test É7.1: CO₂ ppm without absolutePressure is flagged conversion_unavailable.
     */
    public function test_co2_ppm_without_pressure_is_flagged(): void
    {
        $recorder = app(ObservationRecorder::class);

        $quality = $recorder->assessQuality(
            'cabin_co2',
            485,
            'ppm',
            ['sensorId' => 'CO2-SENSOR-02', 'assignment' => 'module_b']
        );

        $this->assertEquals('to_verify', $quality['quality']);
        $this->assertContains('conversion_unavailable', $quality['flags']);
    }

    /**
     * Test É7.2: CO₂ ppm with absolutePressure is valid.
     */
    public function test_co2_ppm_with_pressure_is_valid(): void
    {
        $recorder = app(ObservationRecorder::class);

        $quality = $recorder->assessQuality(
            'cabin_co2',
            520,
            'ppm',
            ['sensorId' => 'CO2-SENSOR-01', 'assignment' => 'module_a', 'absolutePressure' => 760.0]
        );

        $this->assertEquals('valid', $quality['quality']);
        $this->assertNotContains('conversion_unavailable', $quality['flags']);
    }

    /**
     * Test É7.3: CO₂ mmHg does not need absolutePressure.
     */
    public function test_co2_mmhg_does_not_need_pressure(): void
    {
        $recorder = app(ObservationRecorder::class);

        $quality = $recorder->assessQuality(
            'cabin_co2',
            0.68,
            'mmHg',
            ['sensorId' => 'CO2-SENSOR-01', 'assignment' => 'module_a']
        );

        $this->assertEquals('valid', $quality['quality']);
        $this->assertNotContains('conversion_unavailable', $quality['flags']);
    }

    /**
     * Test É8.1: New check-in fields (fatigue, stress, isolation, workload) validate.
     */
    public function test_new_checkin_fields_validate(): void
    {
        $response = $this->putJson('/api/v1/workspaces/demo/crew/moreau/checkins/J200', [
            'status' => 'submitted',
            'submittedBy' => 'moreau',
            'sleep' => ['status' => 'recorded', 'minutes' => 420],
            'sleepiness' => ['status' => 'recorded', 'value' => 3],
            'mood' => ['status' => 'recorded', 'value' => 4],
            'fatigue' => ['status' => 'recorded', 'value' => 2],
            'stress' => ['status' => 'recorded', 'value' => 3],
            'perceivedIsolation' => ['status' => 'skipped'],
            'workload' => ['status' => 'recorded', 'value' => 4],
        ], ['X-Hexta-Actor' => json_encode(['crewId' => 'moreau', 'role' => 'astronaut'])]);

        $response->assertStatus(201);
        $observations = $response->json('data.observations');

        $this->assertNotEmpty(collect($observations)->firstWhere('variable', 'fatigue'));
        $this->assertNotEmpty(collect($observations)->firstWhere('variable', 'stress'));
        $this->assertNotEmpty(collect($observations)->firstWhere('variable', 'perceived_isolation'));
        $this->assertNotEmpty(collect($observations)->firstWhere('variable', 'perceived_workload'));
    }

    /**
     * Test É8.2: Old check-in format (without new fields) still validates.
     */
    public function test_old_checkin_format_validates(): void
    {
        $response = $this->putJson('/api/v1/workspaces/demo/crew/moreau/checkins/J201', [
            'status' => 'submitted',
            'submittedBy' => 'moreau',
            'sleep' => ['status' => 'recorded', 'minutes' => 430],
            'sleepiness' => ['status' => 'recorded', 'value' => 4],
            'mood' => ['status' => 'recorded', 'value' => 3],
            // No fatigue, stress, perceivedIsolation, workload
        ], ['X-Hexta-Actor' => json_encode(['crewId' => 'moreau', 'role' => 'astronaut'])]);

        $response->assertStatus(201);
        $observations = $response->json('data.observations');

        // Should NOT create observations for absent fields
        $this->assertNull(collect($observations)->firstWhere('variable', 'fatigue'));
        $this->assertNull(collect($observations)->firstWhere('variable', 'stress'));
    }

    /**
     * Test É8.3: New check-in fields reject invalid values.
     */
    public function test_new_checkin_fields_reject_invalid_values(): void
    {
        $response = $this->putJson('/api/v1/workspaces/demo/crew/moreau/checkins/J202', [
            'status' => 'submitted',
            'submittedBy' => 'moreau',
            'sleep' => ['status' => 'recorded', 'minutes' => 420],
            'sleepiness' => ['status' => 'recorded', 'value' => 3],
            'fatigue' => ['status' => 'recorded', 'value' => 6], // Invalid: > 5
        ], ['X-Hexta-Actor' => json_encode(['crewId' => 'moreau', 'role' => 'astronaut'])]);

        $response->assertStatus(422);
        $response->assertJsonValidationErrors('fatigue.value');
    }

    /**
     * Test É9.1: Radiation dose rate accepts uGy/h unit.
     */
    public function test_radiation_dose_rate_accepts_ugy_h(): void
    {
        $response = $this->postJson('/api/v1/workspaces/demo/observations', [
            'observationId' => fake()->uuid(),
            'recordedBy' => 'moreau',
            'variable' => 'radiation_dose_rate',
            'unit' => 'uGy/h',
            'value' => 0.42,
            'method' => 'dosimeter_reading',
            'observedAt' => now()->toIso8601String(),
            'context' => [
                'sensorId' => 'RAD-MODULE-A',
                'source' => 'Gateway Module A',
                'assignment' => 'module',
            ],
        ], ['X-Hexta-Actor' => json_encode(['crewId' => 'moreau', 'role' => 'astronaut'])]);

        $response->assertStatus(201);
        $response->assertJsonPath('data.variable', 'radiation_dose_rate');
        $response->assertJsonPath('data.unit', 'uGy/h');
    }

    /**
     * Test É9.2: Radiation readings separate by assignment (module vs crew).
     */
    public function test_radiation_series_key_separates_by_assignment(): void
    {
        $keyModule = ObservationRecorder::seriesKey('radiation_dose_rate', 'dosimeter_reading', 'uGy/h', [
            'sensorId' => 'RAD-MODULE-A',
            'assignment' => 'module',
        ]);

        $keyCrew = ObservationRecorder::seriesKey('radiation_dose_rate', 'dosimeter_reading', 'uGy/h', [
            'sensorId' => 'RAD-BADGE-MOREAU',
            'assignment' => 'crew_member',
        ]);

        $this->assertNotEquals($keyModule, $keyCrew);
        $this->assertStringContainsString('assignment=module', $keyModule);
        $this->assertStringContainsString('assignment=crew_member', $keyCrew);
    }

    /**
     * Test É10.1: Respiratory rate accepts /min unit.
     */
    public function test_respiratory_rate_accepts_per_min(): void
    {
        $response = $this->postJson('/api/v1/workspaces/demo/observations', [
            'observationId' => fake()->uuid(),
            'recordedBy' => 'moreau',
            'variable' => 'respiratory_rate',
            'unit' => '/min',
            'value' => 16,
            'method' => 'manual_count',
            'observedAt' => now()->toIso8601String(),
            'context' => ['atRest' => true],
        ], ['X-Hexta-Actor' => json_encode(['crewId' => 'moreau', 'role' => 'astronaut'])]);

        $response->assertStatus(201);
        $response->assertJsonPath('data.variable', 'respiratory_rate');
        $response->assertJsonPath('data.value', 16);
    }
}
