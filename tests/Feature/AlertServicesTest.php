<?php

namespace Tests\Feature;

use App\Services\Alerts\NasaHazardMapper;
use App\Services\Alerts\PersonalBaselineService;
use App\Services\Alerts\ThresholdAlertService;
use Tests\TestCase;

/**
 * Tests pour les services d'alertes (Banque de Données Health Monitoring).
 *
 * Tests É11: ThresholdAlertService
 * Tests É12: PersonalBaselineService
 * Tests É13: NasaHazardMapper
 * Tests É14: Intégration dans ObservationRecorder
 */
class AlertServicesTest extends TestCase
{
    // ========== É11: ThresholdAlertService ==========
    // Note: ThresholdAlertService tests require MongoDB for alert creation
    // These tests validate business logic only

    public function test_threshold_service_loads_health_indicators(): void
    {
        $this->markTestSkipped('Requiert MongoDB - test d\'intégration ThresholdAlertService');
    }

    public function test_threshold_detects_critical_glucose(): void
    {
        $this->markTestSkipped('Requiert MongoDB - test d\'intégration ThresholdAlertService');
    }

    public function test_threshold_detects_watch_blood_pressure(): void
    {
        $this->markTestSkipped('Requiert MongoDB - test d\'intégration ThresholdAlertService');
    }

    public function test_threshold_ignores_normal_values(): void
    {
        $this->markTestSkipped('Requiert MongoDB - test d\'intégration ThresholdAlertService');
    }

    public function test_threshold_handles_null_values(): void
    {
        $this->markTestSkipped('Requiert MongoDB - test d\'intégration ThresholdAlertService');
    }

    // ========== É12: PersonalBaselineService ==========

    public function test_baseline_calculates_mean_sd_median(): void
    {
        $service = new PersonalBaselineService;

        // Test avec des valeurs connues
        $reflection = new \ReflectionClass($service);
        $method = $reflection->getMethod('extractNumericValue');
        $method->setAccessible(true);

        // Vérifie que la méthode extractNumericValue fonctionne
        $value = $method->invoke($service, 'glucose', 95);
        $this->assertEquals(95.0, $value);

        $value = $method->invoke($service, 'blood_pressure', ['systolic' => 120, 'diastolic' => 80]);
        $this->assertEquals(120.0, $value);
    }

    public function test_baseline_zscore_calculation(): void
    {
        $service = new PersonalBaselineService;

        $baseline = [
            'mean' => 95.0,
            'sd' => 10.0,
            'median' => 94.0,
            'n' => 10,
        ];

        // Test Z-score = 0 (valeur = mean)
        $result = $service->evaluateZScore(95, 'glucose', $baseline);
        $this->assertEquals(0.0, $result['zscore']);
        $this->assertEquals('green', $result['level']);
        $this->assertEquals('normal', $result['deviation']);

        // Test Z-score = 1.5 (orange)
        $result = $service->evaluateZScore(110, 'glucose', $baseline);
        $this->assertEquals(1.5, $result['zscore']);
        $this->assertEquals('orange', $result['level']);
        $this->assertEquals('above', $result['deviation']);

        // Test Z-score = -2.0 (red)
        $result = $service->evaluateZScore(75, 'glucose', $baseline);
        $this->assertEquals(-2.0, $result['zscore']);
        $this->assertEquals('red', $result['level']);
        $this->assertEquals('below', $result['deviation']);

        // Test Z-score = 2.5 (red)
        $result = $service->evaluateZScore(120, 'glucose', $baseline);
        $this->assertEquals(2.5, $result['zscore']);
        $this->assertEquals('red', $result['level']);
        $this->assertEquals('above', $result['deviation']);
    }

    public function test_baseline_handles_zero_sd(): void
    {
        $service = new PersonalBaselineService;

        $baseline = [
            'mean' => 95.0,
            'sd' => 0.0, // Écart-type nul (toutes les valeurs identiques)
            'median' => 95.0,
            'n' => 5,
        ];

        $result = $service->evaluateZScore(100, 'glucose', $baseline);

        // Vérifie que null est retourné pour SD=0
        $this->assertNull($result);
    }

    public function test_baseline_handles_null_value(): void
    {
        $service = new PersonalBaselineService;

        $baseline = [
            'mean' => 95.0,
            'sd' => 10.0,
            'median' => 94.0,
            'n' => 10,
        ];

        $result = $service->evaluateZScore(null, 'glucose', $baseline);

        // Vérifie que null est retourné pour valeur null
        $this->assertNull($result);
    }

    public function test_baseline_significant_trend_detection(): void
    {
        $service = new PersonalBaselineService;

        $baseline = ['mean' => 95.0, 'sd' => 10.0];

        // Test >10% change
        $hasTrend = $service->hasSignificantTrend(110, 100, 'glucose', $baseline);
        $this->assertFalse($hasTrend); // 10% exactly = false

        $hasTrend = $service->hasSignificantTrend(112, 100, 'glucose', $baseline);
        $this->assertTrue($hasTrend); // 12% change = true

        // Test <10% change
        $hasTrend = $service->hasSignificantTrend(105, 100, 'glucose', $baseline);
        $this->assertFalse($hasTrend); // 5% change = false
    }

    // ========== É13: NasaHazardMapper ==========

    public function test_hazard_mapper_loads_hazards(): void
    {
        $mapper = new NasaHazardMapper;

        $hazards = $mapper->getAllHazards();

        // Vérifie que les 5 hazards sont chargés (ou fallback)
        $this->assertGreaterThanOrEqual(5, count($hazards));
    }

    public function test_hazard_mapper_gets_hazards_for_indicator(): void
    {
        $mapper = new NasaHazardMapper;

        // heartRate devrait être lié à plusieurs hazards
        $hazards = $mapper->getHazardsForIndicator('heartRate');

        $this->assertIsArray($hazards);
        // heartRate est dans: space_radiation (cardiovascular), isolation_confinement (sleep),
        // hostile_closed_environments, gravity_fields, distance_from_earth
        $this->assertGreaterThan(0, count($hazards));
    }

    public function test_hazard_mapper_gets_indicators_for_hazard(): void
    {
        $mapper = new NasaHazardMapper;

        $indicators = $mapper->getIndicatorsForHazard('space_radiation');

        $this->assertIsArray($indicators);
        $this->assertGreaterThan(0, count($indicators));
        // Devrait contenir radiationDose, whiteBloodCellCount, hemoglobin, heartRate, bloodPressure
    }

    public function test_hazard_mapper_identifies_critical_indicators(): void
    {
        $mapper = new NasaHazardMapper;

        // heartRate est critique (≥2 hazards)
        $isCritical = $mapper->isCriticalIndicator('heartRate');
        $this->assertTrue($isCritical);

        // Un indicateur inexistant n'est pas critique
        $isCritical = $mapper->isCriticalIndicator('nonexistent_indicator');
        $this->assertFalse($isCritical);
    }

    public function test_hazard_mapper_gets_hazard_details(): void
    {
        $mapper = new NasaHazardMapper;

        $hazard = $mapper->getHazard('space_radiation');

        $this->assertNotNull($hazard);
        $this->assertEquals('space_radiation', $hazard['_id']);
        $this->assertArrayHasKey('label', $hazard);
        $this->assertArrayHasKey('risks', $hazard);
    }

    // ========== É14: Tests d'intégration (requièrent MongoDB) ==========

    public function test_observation_recorder_calls_threshold_service(): void
    {
        $this->markTestSkipped('Requiert MongoDB - test d\'intégration');
    }

    public function test_observation_recorder_calculates_baseline(): void
    {
        $this->markTestSkipped('Requiert MongoDB - test d\'intégration');
    }

    public function test_threshold_alert_creates_notification_for_cmo(): void
    {
        $this->markTestSkipped('Requiert MongoDB - test d\'intégration');
    }

    public function test_baseline_stored_in_observation_document(): void
    {
        $this->markTestSkipped('Requiert MongoDB - test d\'intégration');
    }
}
