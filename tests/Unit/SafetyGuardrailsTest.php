<?php

namespace Tests\Unit;

use App\Services\Agent\AgentRequest;
use App\Services\Agent\AnalysisKind;
use App\Services\Agent\SafetyGuardrails;
use PHPUnit\Framework\TestCase;

class SafetyGuardrailsTest extends TestCase
{
    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function assessment(array $overrides = []): array
    {
        return array_replace([
            'imageQuality' => ['usable' => true, 'issues' => []],
            'urineColor' => null,
            'skinFinding' => null,
            'heartRate' => null,
            'summary' => 'x',
            'recommendations' => [],
            'escalation' => ['level' => 'none', 'reasons' => []],
            'confidence' => 'medium',
            'limitations' => [],
        ], $overrides);
    }

    private function request(AnalysisKind $kind, ?array $heartRate = null, ?bool $atRest = null, ?string $notes = null): AgentRequest
    {
        return new AgentRequest($kind, 'demo', 'moreau', 'Cdr K. Moreau', 142, imageJpeg: 'jpeg', heartRate: $heartRate, atRest: $atRest, crewNotes: $notes);
    }

    public function test_escalation_is_never_lowered(): void
    {
        $result = (new SafetyGuardrails)->apply(
            $this->request(AnalysisKind::UrineColor),
            $this->assessment([
                'urineColor' => ['scale' => 2, 'label' => 'pale', 'unusualColor' => false, 'unusualColorDescription' => null],
                'escalation' => ['level' => 'cmo_urgent', 'reasons' => ['model reason']],
            ]),
            [],
        );

        $this->assertSame('cmo_urgent', $result['assessment']['escalation']['level']);

        // Le système ajoute une recommandation fallback quand le modèle n'en fournit aucune
        // Ceci est un comportement de sécurité intentionnel
        $this->assertCount(1, $result['applied']);
        $this->assertStringContainsString('Used predefined fallback recommendation', $result['applied'][0]);
    }

    public function test_unusual_urine_colour_requires_review(): void
    {
        $result = (new SafetyGuardrails)->apply(
            $this->request(AnalysisKind::UrineColor),
            $this->assessment(['urineColor' => ['scale' => 5, 'label' => 'reddish', 'unusualColor' => true, 'unusualColorDescription' => 'red tint']]),
            [],
        );

        $this->assertSame('cmo_review', $result['assessment']['escalation']['level']);
    }

    public function test_visible_skin_red_flag_is_urgent(): void
    {
        $result = (new SafetyGuardrails)->apply(
            $this->request(AnalysisKind::SkinRash),
            $this->assessment(['skinFinding' => ['bodySite' => 'arm', 'description' => 'd', 'distribution' => 'd', 'estimatedSize' => 's', 'redFlagsObserved' => ['blisters']]]),
            [],
        );

        $this->assertSame('cmo_urgent', $result['assessment']['escalation']['level']);
    }

    public function test_resting_webcam_estimate_outside_range_requires_review(): void
    {
        $heartRate = ['bpm' => 132.0, 'snrDb' => 6.0, 'signalQuality' => 'good', 'durationSeconds' => 20.0, 'sampleRateHz' => 30.0, 'samples' => 600, 'issues' => []];

        $atRest = (new SafetyGuardrails)->apply($this->request(AnalysisKind::WebcamHeartRate, $heartRate, atRest: true), $this->assessment(), []);
        $afterExercise = (new SafetyGuardrails)->apply($this->request(AnalysisKind::WebcamHeartRate, $heartRate, atRest: false), $this->assessment(), []);

        $this->assertSame('cmo_review', $atRest['assessment']['escalation']['level']);
        $this->assertSame('none', $afterExercise['assessment']['escalation']['level']);
    }

    public function test_missing_pulse_value_advises_a_retake(): void
    {
        $heartRate = ['bpm' => null, 'snrDb' => -2.0, 'signalQuality' => 'poor', 'durationSeconds' => 20.0, 'sampleRateHz' => 30.0, 'samples' => 600, 'issues' => ['weak_pulse_signal']];

        $result = (new SafetyGuardrails)->apply($this->request(AnalysisKind::WebcamHeartRate, $heartRate, atRest: true), $this->assessment(), []);

        $this->assertTrue($result['assessment']['heartRate']['retakeAdvised']);
    }
}
