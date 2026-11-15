<?php

namespace Tests\Feature;

use App\Services\Agent\AgentRequest;
use App\Services\Agent\AgentResult;
use App\Services\Agent\Contracts\AssessmentModel;
use App\Services\Agent\KnowledgeSearch;
use App\Services\Demo\DemoScenario;
use ArrayObject;
use Closure;
use Illuminate\Http\UploadedFile;
use Tests\TestCase;

class VisionAgentTest extends TestCase
{
    /** @var ArrayObject<int, AgentRequest> */
    private ArrayObject $modelRequests;

    protected function setUp(): void
    {
        parent::setUp();

        $this->modelRequests = new ArrayObject;
        $this->freshMongoDatabase();
        $this->artisan('migrate', ['--force' => true])->assertSuccessful();
        $this->artisan('hexta:import-nasa-data', ['--knowledge-only' => true])->assertSuccessful();
        app(DemoScenario::class)->install();
    }

    /**
     * @param  Closure(AgentRequest): array<string, mixed>  $assessment
     * @param  list<string>  $retrieved
     */
    private function fakeModel(Closure $assessment, array $retrieved = ['vision-urine-color-scale']): void
    {
        $this->app->instance(AssessmentModel::class, new class($assessment, $retrieved, $this->modelRequests) implements AssessmentModel
        {
            /**
             * @param  list<string>  $retrieved
             * @param  ArrayObject<int, AgentRequest>  $requests
             */
            public function __construct(private Closure $assessment, private array $retrieved, private ArrayObject $requests) {}

            public function assess(AgentRequest $request): AgentResult
            {
                $this->requests[] = $request;

                return new AgentResult(($this->assessment)($request), $this->retrieved, [['tool' => 'search_knowledge', 'input' => ['query' => 'test']]], 'claude-opus-5-5', ['inputTokens' => 1200, 'outputTokens' => 300, 'cacheReadInputTokens' => 0]);
            }
        });
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function assessment(array $overrides = []): array
    {
        return array_replace_recursive([
            'imageQuality' => ['usable' => true, 'issues' => []],
            'urineColor' => null,
            'skinFinding' => null,
            'heartRate' => null,
            'summary' => 'Test summary.',
            'recommendations' => [['action' => 'Drink water and re-check this afternoon.', 'rationale' => 'Colour chart.', 'sourceIds' => ['vision-urine-color-scale']]],
            'escalation' => ['level' => 'none', 'reasons' => []],
            'confidence' => 'medium',
            'limitations' => ['A single photo does not characterise hydration.'],
        ], $overrides);
    }

    private function uploadPhoto(string $kind, string $subjectId = 'moreau', string $workspace = 'demo'): string
    {
        $response = $this->post(route('api.v1.workspaces.media.store', $workspace), [
            'file' => UploadedFile::fake()->image('photo.png', 2400, 1600),
            'kind' => $kind,
            'subjectId' => $subjectId,
            'uploadedBy' => $subjectId,
        ], ['Accept' => 'application/json']);

        $response->assertCreated();

        return $response->json('mediaId');
    }

    public function test_photo_is_reencoded_into_gridfs_and_scoped_to_its_workspace(): void
    {
        $mediaId = $this->uploadPhoto('urine_color');

        $file = $this->mongoCollection('media.files')->findOne(['_id' => $mediaId]);
        $this->assertSame('demo', $file['metadata']['workspaceId']);
        $this->assertSame(1568, $file['metadata']['width']);
        $this->assertTrue($file['metadata']['exifStripped']);

        $this->get(route('api.v1.workspaces.media.show', ['demo', $mediaId]))
            ->assertOk()
            ->assertHeader('Content-Type', 'image/jpeg');

        $this->get(route('api.v1.workspaces.media.show', ['explore', $mediaId]))->assertNotFound();
    }

    public function test_non_image_upload_is_rejected(): void
    {
        $this->post(route('api.v1.workspaces.media.store', 'demo'), [
            'file' => UploadedFile::fake()->createWithContent('photo.jpg', 'not an image'),
            'kind' => 'urine_color',
            'subjectId' => 'moreau',
            'uploadedBy' => 'moreau',
        ], ['Accept' => 'application/json'])->assertUnprocessable();
    }

    public function test_urine_analysis_records_a_to_verify_reading_and_filters_unretrieved_sources(): void
    {
        $mediaId = $this->uploadPhoto('urine_color');
        $this->fakeModel(fn (): array => $this->assessment([
            'urineColor' => ['scale' => 3, 'label' => 'Pale yellow', 'unusualColor' => false, 'unusualColorDescription' => null],
            'recommendations' => [['action' => 'Keep drinking regularly.', 'rationale' => 'Chart.', 'sourceIds' => ['vision-urine-color-scale', 'invented-source']]],
        ]));

        $response = $this->postJson(route('api.v1.workspaces.analyses.store', 'demo'), [
            'kind' => 'urine_color', 'subjectId' => 'moreau', 'requestedBy' => 'moreau', 'mediaId' => $mediaId,
        ]);

        $response->assertCreated()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.missionDay', 142)
            ->assertJsonPath('data.escalation.level', 'none')
            ->assertJsonPath('data.assessment.recommendations.0.sourceIds', ['vision-urine-color-scale'])
            ->assertJsonPath('data.sources.0.id', 'vision-urine-color-scale')
            ->assertJsonPath('data.followUpId', null);

        $this->assertStringContainsString('invented-source', $response->json('data.guardrails.0'));
        $this->assertNotNull($this->modelRequests[0]->imageJpeg);

        $observation = $this->mongoCollection('observations')->findOne(['_id' => $response->json('data.observationId')]);
        $this->assertSame('urine_color', $observation['variable']);
        $this->assertSame(3, $observation['value']);
        $this->assertSame('photo_ai_estimate', $observation['method']);
        $this->assertSame('to_verify', $observation['quality']);
    }

    public function test_dark_urine_is_escalated_for_cmo_review(): void
    {
        $mediaId = $this->uploadPhoto('urine_color');
        $this->fakeModel(fn (): array => $this->assessment([
            'urineColor' => ['scale' => 7, 'label' => 'Dark amber', 'unusualColor' => false, 'unusualColorDescription' => null],
        ]));

        $response = $this->postJson(route('api.v1.workspaces.analyses.store', 'demo'), [
            'kind' => 'urine_color', 'subjectId' => 'moreau', 'requestedBy' => 'moreau', 'mediaId' => $mediaId,
        ])->assertCreated()->assertJsonPath('data.escalation.level', 'cmo_review');

        $notification = $this->mongoCollection('notifications')->findOne(['workspaceId' => 'demo', 'recipientId' => 'haddad']);
        $this->assertSame('Crew review requested', $notification['title']);
        $this->assertSame($response->json('data.followUpId'), $notification['target']['id']);
    }

    public function test_reported_skin_red_flag_forces_urgent_review_even_if_model_says_none(): void
    {
        $mediaId = $this->uploadPhoto('skin_rash');
        $this->fakeModel(fn (): array => $this->assessment([
            'skinFinding' => ['bodySite' => 'left forearm', 'description' => 'Grouped red raised spots.', 'distribution' => 'grouped', 'estimatedSize' => 'about 3 cm', 'redFlagsObserved' => []],
        ]), retrieved: ['vision-skin-red-flags']);

        $response = $this->postJson(route('api.v1.workspaces.analyses.store', 'demo'), [
            'kind' => 'skin_rash', 'subjectId' => 'moreau', 'requestedBy' => 'moreau', 'mediaId' => $mediaId,
            'bodySite' => 'left forearm', 'notes' => 'Itchy since yesterday, I also have a fever.',
        ])->assertCreated();

        $response->assertJsonPath('data.escalation.level', 'cmo_urgent');
        $followUp = $this->mongoCollection('follow_ups')->findOne(['_id' => $response->json('data.followUpId')]);
        $this->assertSame('open', $followUp['status']);
        $this->assertSame('cmo_urgent', $followUp['priority']);
        $this->assertSame('haddad', $followUp['targetId']);
        $this->assertSame('skin_observation', $this->mongoCollection('observations')->findOne(['_id' => $response->json('data.observationId')])['variable']);
    }

    public function test_unusable_photo_records_nothing(): void
    {
        $mediaId = $this->uploadPhoto('skin_rash');
        $this->fakeModel(fn (): array => $this->assessment([
            'imageQuality' => ['usable' => false, 'issues' => ['blurred']],
            'skinFinding' => ['bodySite' => '?', 'description' => '?', 'distribution' => '?', 'estimatedSize' => '?', 'redFlagsObserved' => []],
        ]));

        $this->postJson(route('api.v1.workspaces.analyses.store', 'demo'), [
            'kind' => 'skin_rash', 'subjectId' => 'moreau', 'requestedBy' => 'moreau', 'mediaId' => $mediaId,
        ])->assertCreated()
            ->assertJsonPath('data.assessment.skinFinding', null)
            ->assertJsonPath('data.observationId', null)
            ->assertJsonPath('data.escalation.level', 'none');
    }

    public function test_webcam_trace_is_measured_server_side_and_stored_as_its_own_series(): void
    {
        $this->fakeModel(fn (AgentRequest $request): array => $this->assessment([
            'heartRate' => ['interpretation' => 'Estimate consistent with a resting pulse.', 'retakeAdvised' => false],
        ]), retrieved: ['vision-rppg-method']);

        $response = $this->postJson(route('api.v1.workspaces.analyses.store', 'demo'), [
            'kind' => 'webcam_heart_rate', 'subjectId' => 'sato', 'requestedBy' => 'sato', 'atRest' => true,
            'signal' => ['roi' => 'face', 'samples' => $this->webcamTrace(72.0)],
        ])->assertCreated();

        $this->assertEqualsWithDelta(72.0, $response->json('data.input.heartRateMeasurement.bpm'), 2.0);
        $this->assertNull($this->modelRequests[0]->imageJpeg);

        $observation = $this->mongoCollection('observations')->findOne(['_id' => $response->json('data.observationId')]);
        $this->assertSame('heart_rate', $observation['variable']);
        $this->assertSame('webcam_rppg', $observation['method']);
        $this->assertSame('to_verify', $observation['quality']);
        $this->assertTrue($observation['context']['atRest']);
    }

    public function test_malformed_webcam_samples_are_rejected(): void
    {
        $samples = $this->webcamTrace(72.0);
        $samples[10] = [1000, 300, 10, 10];

        $this->postJson(route('api.v1.workspaces.analyses.store', 'demo'), [
            'kind' => 'webcam_heart_rate', 'subjectId' => 'sato', 'requestedBy' => 'sato', 'atRest' => true,
            'signal' => ['samples' => $samples],
        ])->assertUnprocessable()->assertJsonValidationErrors('signal.samples.10');
    }

    public function test_photo_of_another_crew_member_is_rejected(): void
    {
        $mediaId = $this->uploadPhoto('urine_color', subjectId: 'sato');

        $this->postJson(route('api.v1.workspaces.analyses.store', 'demo'), [
            'kind' => 'urine_color', 'subjectId' => 'moreau', 'requestedBy' => 'moreau', 'mediaId' => $mediaId,
        ])->assertUnprocessable()->assertJsonValidationErrors('mediaId');
    }

    public function test_missing_api_key_keeps_a_retryable_failed_analysis_that_can_be_retried(): void
    {
        $mediaId = $this->uploadPhoto('urine_color');

        $failed = $this->postJson(route('api.v1.workspaces.analyses.store', 'demo'), [
            'kind' => 'urine_color', 'subjectId' => 'moreau', 'requestedBy' => 'moreau', 'mediaId' => $mediaId,
        ]);

        $failed->assertAccepted()
            ->assertJsonPath('data.status', 'failed')
            ->assertJsonPath('data.error.retryable', true);

        $this->fakeModel(fn (): array => $this->assessment([
            'urineColor' => ['scale' => 2, 'label' => 'Very pale yellow', 'unusualColor' => false, 'unusualColorDescription' => null],
        ]));

        $this->postJson(route('api.v1.workspaces.analyses.retry', ['demo', $failed->json('data.analysisId')]))
            ->assertOk()
            ->assertJsonPath('data.status', 'completed')
            ->assertJsonPath('data.attempts', 2)
            ->assertJsonPath('data.error', null);

        $this->getJson(route('api.v1.workspaces.crew.analyses', ['demo', 'moreau']))
            ->assertOk()
            ->assertJsonCount(1, 'data');
    }

    public function test_knowledge_text_search_finds_vision_documents(): void
    {
        $results = app(KnowledgeSearch::class)->search('urine colour chart hydration', ['urine_color']);

        $this->assertSame('vision-urine-color-scale', $results[0]['id']);
        $this->assertTrue($results[0]['validated']);
    }

    public function test_recommendation_without_valid_sources_is_replaced_by_fallback(): void
    {
        $mediaId = $this->uploadPhoto('urine_color');
        $this->fakeModel(fn (): array => $this->assessment([
            'urineColor' => ['scale' => 5, 'label' => 'Yellow', 'unusualColor' => false, 'unusualColorDescription' => null],
            'recommendations' => [
                ['action' => 'This has sources.', 'rationale' => 'Valid.', 'sourceIds' => ['vision-urine-color-scale']],
                ['action' => 'This has no sources.', 'rationale' => 'Invalid.', 'sourceIds' => ['fake-source-1', 'fake-source-2']],
            ],
        ]));

        $response = $this->postJson(route('api.v1.workspaces.analyses.store', 'demo'), [
            'kind' => 'urine_color', 'subjectId' => 'moreau', 'requestedBy' => 'moreau', 'mediaId' => $mediaId,
        ])->assertCreated();

        $this->assertCount(1, $response->json('data.assessment.recommendations'));
        $this->assertSame('This has sources.', $response->json('data.assessment.recommendations.0.action'));
        $this->assertStringContainsString('Removed recommendation without valid sources', $response->json('data.guardrails.1'));
    }

    public function test_all_recommendations_without_sources_triggers_fallback(): void
    {
        $mediaId = $this->uploadPhoto('skin_rash');
        $this->fakeModel(fn (): array => $this->assessment([
            'skinFinding' => ['bodySite' => 'arm', 'description' => 'Redness.', 'distribution' => 'localized', 'estimatedSize' => '2 cm', 'redFlagsObserved' => [], 'symptomsReportedByCrew' => []],
            'recommendations' => [['action' => 'Do something.', 'rationale' => 'Trust me.', 'sourceIds' => ['fake-id']]],
        ]), retrieved: []);

        $response = $this->postJson(route('api.v1.workspaces.analyses.store', 'demo'), [
            'kind' => 'skin_rash', 'subjectId' => 'moreau', 'requestedBy' => 'moreau', 'mediaId' => $mediaId,
        ])->assertCreated();

        $this->assertCount(1, $response->json('data.assessment.recommendations'));
        $this->assertStringContainsString('Request a review by the Crew Medical Officer', $response->json('data.assessment.recommendations.0.action'));
        $this->assertSame([], $response->json('data.assessment.recommendations.0.sourceIds'));
        $this->assertStringContainsString('Used predefined fallback recommendation', $response->json('data.guardrails.1'));
    }

    public function test_no_fever_in_notes_does_not_trigger_escalation(): void
    {
        $mediaId = $this->uploadPhoto('skin_rash');
        $this->fakeModel(fn (): array => $this->assessment([
            'skinFinding' => ['bodySite' => 'arm', 'description' => 'Minor redness.', 'distribution' => 'localized', 'estimatedSize' => '1 cm', 'redFlagsObserved' => [], 'symptomsReportedByCrew' => []],
        ]), retrieved: ['vision-skin-red-flags']);

        $response = $this->postJson(route('api.v1.workspaces.analyses.store', 'demo'), [
            'kind' => 'skin_rash', 'subjectId' => 'moreau', 'requestedBy' => 'moreau', 'mediaId' => $mediaId,
            'bodySite' => 'arm', 'notes' => 'No fever, no pain. Just noticed this today.',
        ])->assertCreated();

        $this->assertSame('cmo_review', $response->json('data.escalation.level'));
        $this->assertStringNotContainsString('fever', strtolower(implode(' ', $response->json('data.escalation.reasons'))));
    }

    public function test_fever_reported_yesterday_does_not_trigger_urgent_escalation(): void
    {
        $mediaId = $this->uploadPhoto('skin_rash');
        $this->fakeModel(fn (): array => $this->assessment([
            'skinFinding' => ['bodySite' => 'arm', 'description' => 'Redness.', 'distribution' => 'localized', 'estimatedSize' => '2 cm', 'redFlagsObserved' => [], 'symptomsReportedByCrew' => []],
        ]), retrieved: ['vision-skin-red-flags']);

        $response = $this->postJson(route('api.v1.workspaces.analyses.store', 'demo'), [
            'kind' => 'skin_rash', 'subjectId' => 'moreau', 'requestedBy' => 'moreau', 'mediaId' => $mediaId,
            'bodySite' => 'arm', 'notes' => 'I had fever yesterday but it is gone now.',
        ])->assertCreated();

        $this->assertSame('cmo_review', $response->json('data.escalation.level'));
    }

    public function test_model_reported_symptom_distinguished_from_visible_flag(): void
    {
        $mediaId = $this->uploadPhoto('skin_rash');
        $this->fakeModel(fn (): array => $this->assessment([
            'skinFinding' => [
                'bodySite' => 'forearm',
                'description' => 'Red raised spots.',
                'distribution' => 'grouped',
                'estimatedSize' => '3 cm',
                'redFlagsObserved' => ['swelling'],
                'symptomsReportedByCrew' => ['fever', 'pain'],
            ],
        ]), retrieved: ['vision-skin-red-flags']);

        $response = $this->postJson(route('api.v1.workspaces.analyses.store', 'demo'), [
            'kind' => 'skin_rash', 'subjectId' => 'moreau', 'requestedBy' => 'moreau', 'mediaId' => $mediaId,
            'bodySite' => 'forearm', 'notes' => 'It hurts and I have fever.',
        ])->assertCreated();

        $this->assertSame('cmo_urgent', $response->json('data.escalation.level'));
        $reasons = implode(' ', $response->json('data.escalation.reasons'));
        $this->assertStringContainsString('visible: swelling', $reasons);
        $this->assertStringContainsString('reported:', $reasons);
    }

    public function test_astronaut_cannot_access_another_astronaut_analysis(): void
    {
        config(['hexta.identity.required' => true]);

        $mediaId = $this->uploadPhoto('urine_color', subjectId: 'moreau');
        $this->fakeModel(fn (): array => $this->assessment([
            'urineColor' => ['scale' => 3, 'label' => 'Pale yellow', 'unusualColor' => false, 'unusualColorDescription' => null],
        ]));

        $response = $this->postJson(route('api.v1.workspaces.analyses.store', 'demo'), [
            'kind' => 'urine_color', 'subjectId' => 'moreau', 'requestedBy' => 'moreau', 'mediaId' => $mediaId,
        ])->assertCreated();

        $analysisId = $response->json('data.analysisId');

        $this->withHeader('X-Hexta-Actor', 'sato')
            ->getJson(route('api.v1.workspaces.analyses.show', ['demo', $analysisId]))
            ->assertForbidden()
            ->assertJsonPath('message', 'You can only access your own analyses. Medical reviews are restricted to the CMO.');
    }

    public function test_cmo_can_access_any_crew_member_analysis(): void
    {
        config(['hexta.identity.required' => true]);

        $mediaId = $this->uploadPhoto('urine_color', subjectId: 'moreau');
        $this->fakeModel(fn (): array => $this->assessment([
            'urineColor' => ['scale' => 3, 'label' => 'Pale yellow', 'unusualColor' => false, 'unusualColorDescription' => null],
        ]));

        $response = $this->postJson(route('api.v1.workspaces.analyses.store', 'demo'), [
            'kind' => 'urine_color', 'subjectId' => 'moreau', 'requestedBy' => 'moreau', 'mediaId' => $mediaId,
        ])->assertCreated();

        $analysisId = $response->json('data.analysisId');

        $this->withHeader('X-Hexta-Actor', 'haddad')
            ->getJson(route('api.v1.workspaces.analyses.show', ['demo', $analysisId]))
            ->assertOk()
            ->assertJsonPath('data.subjectId', 'moreau');
    }

    public function test_subject_can_access_own_analysis(): void
    {
        config(['hexta.identity.required' => true]);

        $mediaId = $this->uploadPhoto('urine_color', subjectId: 'moreau');
        $this->fakeModel(fn (): array => $this->assessment([
            'urineColor' => ['scale' => 3, 'label' => 'Pale yellow', 'unusualColor' => false, 'unusualColorDescription' => null],
        ]));

        $response = $this->postJson(route('api.v1.workspaces.analyses.store', 'demo'), [
            'kind' => 'urine_color', 'subjectId' => 'moreau', 'requestedBy' => 'moreau', 'mediaId' => $mediaId,
        ])->assertCreated();

        $analysisId = $response->json('data.analysisId');

        $this->withHeader('X-Hexta-Actor', 'moreau')
            ->getJson(route('api.v1.workspaces.analyses.show', ['demo', $analysisId]))
            ->assertOk()
            ->assertJsonPath('data.subjectId', 'moreau');
    }

    /**
     * @return list<array{0: float, 1: float, 2: float, 3: float}>
     */
    private function webcamTrace(float $bpm): array
    {
        mt_srand(7);
        $samples = [];

        for ($time = 0.0; $time <= 20000; $time += 33.3) {
            $pulse = sin(2 * M_PI * ($bpm / 60) * $time / 1000);
            $samples[] = [$time, 150 + 0.2 * $pulse + mt_rand(-10, 10) / 100, 120 + 0.6 * $pulse + mt_rand(-10, 10) / 100, 100 + 0.15 * $pulse + mt_rand(-10, 10) / 100];
        }

        return $samples;
    }
}
