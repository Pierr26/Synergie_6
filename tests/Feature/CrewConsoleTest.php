<?php

namespace Tests\Feature;

use App\Services\Demo\DemoScenario;
use Illuminate\Support\Str;
use Tests\TestCase;

class CrewConsoleTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->freshMongoDatabase();
        $this->artisan('migrate', ['--force' => true])->assertSuccessful();
        app(DemoScenario::class)->install();
    }

    private function submitDay142(int $minutes = 312): void
    {
        $this->putJson(route('api.v1.workspaces.crew.checkins.upsert', ['demo', 'moreau', 142]), [
            'status' => 'submitted', 'submittedBy' => 'moreau',
            'sleep' => ['status' => 'recorded', 'minutes' => $minutes],
            'sleepiness' => ['status' => 'recorded', 'value' => 8],
        ])->assertOk();
    }

    /**
     * @return list<string>
     */
    private function inboxTitles(string $crewId): array
    {
        return array_column($this->getJson(route('api.v1.workspaces.crew.notifications.index', ['demo', $crewId]))->json('data'), 'title');
    }

    public function test_crew_list_uses_motivated_states_instead_of_a_score(): void
    {
        $crew = collect($this->getJson(route('api.v1.workspaces.console.index', 'demo'))->assertOk()->json('data.crew'))->keyBy('crewId');

        $this->assertSame(['moreau', 'sato'], $crew->keys()->sort()->values()->all());
        $this->assertSame('check', $crew['moreau']['state']);
        $this->assertContains('No check-in saved for day 142', $crew['moreau']['reasons']);
        $this->assertSame(141, $crew['moreau']['lastCheckin']['missionDay']);

        $this->submitDay142();

        $moreau = collect($this->getJson(route('api.v1.workspaces.console.index', 'demo'))->json('data.crew'))->firstWhere('crewId', 'moreau');
        $this->assertSame('needs_review', $moreau['state']);
        $this->assertSame(['1 alert(s) need review'], $moreau['reasons']);
    }

    public function test_crew_file_shows_trends_with_gaps_reference_and_labs(): void
    {
        $file = $this->getJson(route('api.v1.workspaces.console.show', ['demo', 'moreau']))->assertOk()->json('data');

        $sleep = $file['trends']['sleep_duration'];
        $this->assertSame('sleep_diary', $sleep['method']);
        $this->assertCount(14, $sleep['points']);
        $this->assertSame(129, $sleep['points'][0]['missionDay']);
        $this->assertSame(['missionDay' => 142, 'value' => null, 'quality' => 'no_reading', 'observationId' => null], $sleep['points'][13]);
        $this->assertSame(438.5, $file['sleepReference']['median']);
        $this->assertSame('Simulated crew data', $file['dataLabel']);
        $this->assertSame([142], $file['missing']['daysWithoutCheckin']);
        $this->assertSame(['hematocrit', 'hemoglobin'], collect($file['labResults'])->pluck('analyte')->sort()->values()->all());
        $this->assertContains('temperature|skin_sensor|Cel|site=skin', array_column($file['latestMeasurements'], 'seriesKey'));
    }

    public function test_alert_review_is_kept_when_the_episode_is_re_evaluated(): void
    {
        $this->submitDay142();
        $alertId = 'alert-demo-moreau-SLEEP-001-J140';

        $this->postJson(route('api.v1.workspaces.alerts.review', ['demo', $alertId]), [
            'cmoId' => 'haddad', 'note' => 'Discussed sleep plan.', 'decision' => 'follow_up_requested',
        ])->assertOk()->assertJsonPath('data.status', 'reviewed')->assertJsonPath('data.reviews.0.cmoId', 'haddad');

        $this->postJson(route('api.v1.workspaces.alerts.review', ['demo', $alertId]), [
            'cmoId' => 'moreau', 'note' => 'x', 'decision' => 'reviewed',
        ])->assertUnprocessable();

        $this->submitDay142(300);

        $alert = $this->mongoCollection('alerts')->findOne(['_id' => $alertId]);
        $this->assertSame('reviewed', $alert['status']);
        $this->assertCount(1, $alert['reviews']);
        $this->assertSame(300, $alert['evidence'][2]['minutes']);
    }

    public function test_cmo_follow_up_request_reply_and_closure_are_traceable(): void
    {
        $requestId = (string) Str::uuid();
        $payload = [
            'clientRequestId' => $requestId, 'type' => 'follow_up_request', 'authorId' => 'haddad', 'subjectId' => 'moreau',
            'reason' => 'Please log tonight\'s sleep and your sleepiness tomorrow morning.', 'requested' => ['kind' => 'checkin'],
        ];

        $this->postJson(route('api.v1.workspaces.follow-ups.store', 'demo'), $payload)->assertCreated()->assertJsonPath('data.status', 'open');
        $this->postJson(route('api.v1.workspaces.follow-ups.store', 'demo'), $payload)->assertOk();
        $this->assertSame(['New follow-up request'], $this->inboxTitles('moreau'));

        $notificationId = $this->getJson(route('api.v1.workspaces.crew.notifications.index', ['demo', 'moreau']))->json('data.0.id');
        $this->postJson(route('api.v1.workspaces.notifications.read', ['demo', $notificationId]))->assertOk();
        $this->getJson(route('api.v1.workspaces.follow-ups.show', ['demo', $requestId]))->assertJsonPath('data.status', 'open');

        $this->postJson(route('api.v1.workspaces.follow-ups.respond', ['demo', $requestId]), [
            'responderId' => 'sato', 'message' => 'Not mine.',
        ])->assertConflict();

        $this->submitDay142();
        $responseId = (string) Str::uuid();
        $answered = $this->postJson(route('api.v1.workspaces.follow-ups.respond', ['demo', $requestId]), [
            'responseId' => $responseId, 'responderId' => 'moreau', 'message' => 'Check-in saved.', 'checkinId' => 'demo-moreau-checkin-J142',
        ])->assertOk();

        $answered->assertJsonPath('data.status', 'answered')->assertJsonPath('data.responses.0.responseId', $responseId);
        $this->assertContains('Follow-up completed', $this->inboxTitles('haddad'));

        $this->postJson(route('api.v1.workspaces.follow-ups.close', ['demo', $requestId]), ['cmoId' => 'haddad', 'note' => 'Done.'])
            ->assertOk()
            ->assertJsonPath('data.status', 'closed');

        $this->getJson(route('api.v1.workspaces.follow-ups.index', 'demo').'?crewId=moreau&status=closed')->assertJsonCount(1, 'data');
    }

    public function test_crew_review_request_notifies_the_cmo_without_sending_anything_to_ground(): void
    {
        $this->postJson(route('api.v1.workspaces.follow-ups.store', 'explore'), [
            'type' => 'review_request', 'authorId' => 'okafor', 'subjectId' => 'lindqvist', 'reason' => 'x',
        ])->assertUnprocessable()->assertJsonValidationErrors('authorId');

        $this->postJson(route('api.v1.workspaces.follow-ups.store', 'explore'), [
            'type' => 'review_request', 'authorId' => 'okafor', 'subjectId' => 'okafor',
            'reason' => 'Headache since this morning.', 'evidence' => ['symptom' => 'headache'],
        ])->assertCreated()->assertJsonPath('data.targetId', 'ibarra');

        $titles = array_column($this->getJson(route('api.v1.workspaces.crew.notifications.index', ['explore', 'ibarra']))->json('data'), 'title');
        $this->assertSame(['Crew review requested'], $titles);
        $this->assertSame(0, $this->mongoCollection('report_snapshots')->countDocuments());
        $this->assertSame(0, $this->mongoCollection('alerts')->countDocuments());
    }
}
