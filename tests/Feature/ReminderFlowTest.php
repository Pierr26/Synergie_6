<?php

namespace Tests\Feature;

use App\Services\Demo\DemoScenario;
use Tests\TestCase;

class ReminderFlowTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->freshMongoDatabase();
        $this->artisan('migrate', ['--force' => true])->assertSuccessful();
        app(DemoScenario::class)->install();
    }

    /**
     * @return array<string, mixed>
     */
    private function plan(string $crewId = 'moreau', string $workspace = 'demo'): array
    {
        return $this->getJson(route('api.v1.workspaces.crew.plan', [$workspace, $crewId]))->assertOk()->json('data');
    }

    private function advance(int $minutes): void
    {
        $this->postJson(route('api.v1.workspaces.clock.update', 'demo'), ['minutes' => $minutes])->assertOk();
    }

    private function unread(string $crewId): int
    {
        return $this->getJson(route('api.v1.workspaces.crew.notifications.index', ['demo', $crewId]))->json('unreadActive');
    }

    /**
     * @return array<string, mixed>
     */
    private function checkin(int $sleepMinutes, string $workspace = 'demo', string $crewId = 'moreau'): array
    {
        return [
            'status' => 'submitted',
            'submittedBy' => $crewId,
            'sleep' => ['status' => 'recorded', 'minutes' => $sleepMinutes],
            'sleepiness' => ['status' => 'recorded', 'value' => 8],
            'mood' => ['status' => 'recorded', 'value' => 2],
            'symptoms' => ['answer' => 'no'],
        ];
    }

    public function test_guided_scenario_from_scheduled_to_sleep_alert(): void
    {
        $plan = $this->plan();
        $this->assertSame(142, $plan['clock']['missionDay']);
        $this->assertSame('scheduled', $plan['today']['state']);
        $this->assertSame('Scheduled 07:00', $plan['banner']['label']);
        $this->assertFalse($plan['banner']['visible']);

        $this->advance(1);
        $plan = $this->plan();
        $this->assertSame('due', $plan['today']['state']);
        $this->assertTrue($plan['banner']['visible']);
        $this->assertSame('Daily check-in is due', $plan['banner']['label']);
        $this->assertSame(1, $this->unread('moreau'));

        $notificationId = $this->getJson(route('api.v1.workspaces.crew.notifications.index', ['demo', 'moreau']))->json('data.0.id');
        $this->postJson(route('api.v1.workspaces.notifications.read', ['demo', $notificationId]))->assertOk();
        $this->assertSame(0, $this->unread('moreau'));

        $plan = $this->postJson(route('api.v1.workspaces.crew.tasks.snooze', ['demo', 'moreau', 142]))->assertOk()->json('data');
        $this->assertSame('snoozed', $plan['today']['state']);
        $this->assertSame('Snoozed until 07:30', $plan['banner']['label']);
        $this->assertSame('2026-11-08T07:30:00Z', $plan['banner']['snoozedUntil']);

        $this->advance(29);
        $this->assertSame('snoozed', $this->plan()['today']['state']);

        $this->advance(1);
        $plan = $this->plan();
        $this->assertSame('due', $plan['today']['state']);
        $this->assertTrue($plan['banner']['visible']);
        $this->assertSame(1, $this->unread('moreau'), 'A snoozed reminder becomes unread again once.');
        $this->plan();
        $this->assertSame(1, $this->unread('moreau'));

        $plan = $this->postJson(route('api.v1.workspaces.crew.tasks.dismiss', ['demo', 'moreau', 142]))->assertOk()->json('data');
        $this->assertFalse($plan['banner']['visible']);
        $this->assertSame('due', $plan['today']['state']);

        $response = $this->putJson(route('api.v1.workspaces.crew.checkins.upsert', ['demo', 'moreau', 142]), $this->checkin(312))->assertOk();
        $this->assertSame('submitted', $response->json('data.status'));
        $this->assertSame([336, 324, 312], array_column($response->json('alerts.0.evidence'), 'minutes'));
        $this->assertSame('Demo rule', $response->json('alerts.0.label'));

        $plan = $this->plan();
        $this->assertSame('completed', $plan['today']['state']);
        $this->assertSame('Saved on this device', $plan['banner']['label']);
        $this->assertSame(0, $this->unread('moreau'));

        $cmoInbox = $this->getJson(route('api.v1.workspaces.crew.notifications.index', ['demo', 'haddad']))->json('data');
        $this->assertSame(['Sleep trend needs review'], array_column($cmoInbox, 'title'));

        $this->putJson(route('api.v1.workspaces.crew.checkins.upsert', ['demo', 'moreau', 142]), $this->checkin(312))->assertOk();
        $this->assertSame(1, $this->mongoCollection('alerts')->countDocuments());
        $this->assertCount(1, $this->getJson(route('api.v1.workspaces.crew.notifications.index', ['demo', 'haddad']))->json('data'));
    }

    public function test_fourth_short_night_extends_the_same_alert(): void
    {
        $this->putJson(route('api.v1.workspaces.crew.checkins.upsert', ['demo', 'moreau', 142]), $this->checkin(312))->assertOk();
        $this->postJson(route('api.v1.workspaces.clock.update', 'demo'), ['at' => '2026-11-09T07:05:00Z'])->assertOk();

        $response = $this->putJson(route('api.v1.workspaces.crew.checkins.upsert', ['demo', 'moreau', 143]), $this->checkin(300))->assertOk();

        $this->assertCount(1, $response->json('alerts'));
        $this->assertSame(143, $response->json('alerts.0.lastDay'));
        $this->assertSame(1, $this->mongoCollection('alerts')->countDocuments());
    }

    public function test_correcting_the_night_above_threshold_withdraws_the_alert(): void
    {
        $this->putJson(route('api.v1.workspaces.crew.checkins.upsert', ['demo', 'moreau', 142]), $this->checkin(312))->assertOk();

        $response = $this->putJson(route('api.v1.workspaces.crew.checkins.upsert', ['demo', 'moreau', 142]), $this->checkin(400))->assertOk();

        $this->assertSame([], $response->json('alerts'));
        $this->assertSame('no_longer_met', $this->mongoCollection('alerts')->findOne()['status']);
        $this->assertSame(2, $this->mongoCollection('observations')->countDocuments(['lineageId' => 'demo-moreau-sleep_duration-main-J142']));
    }

    public function test_open_task_of_a_previous_day_is_missed(): void
    {
        $this->advance(1);
        $this->plan();
        $this->postJson(route('api.v1.workspaces.clock.update', 'demo'), ['at' => '2026-11-09T06:00:00Z'])->assertOk();

        $plan = $this->plan();

        $this->assertSame(143, $plan['today']['missionDay']);
        $this->assertSame('scheduled', $plan['today']['state']);
        $this->assertSame('missed', $plan['history'][0]['state']);
        $this->assertSame(142, $plan['history'][0]['missionDay']);
    }

    public function test_snooze_is_refused_when_it_would_cross_into_the_next_day(): void
    {
        $this->postJson(route('api.v1.workspaces.clock.update', 'demo'), ['at' => '2026-11-08T23:45:00Z'])->assertOk();

        $this->assertFalse($this->plan()['banner']['canSnooze']);
        $this->postJson(route('api.v1.workspaces.crew.tasks.snooze', ['demo', 'moreau', 142]))->assertConflict();
    }

    public function test_changing_time_recomputes_due_and_disabling_hides_banner_and_bell(): void
    {
        $this->advance(1);
        $this->postJson(route('api.v1.workspaces.crew.tasks.snooze', ['demo', 'moreau', 142]))->assertOk();

        $plan = $this->putJson(route('api.v1.workspaces.crew.reminder-settings', ['demo', 'moreau']), ['enabled' => true, 'time' => '09:00'])->assertOk()->json('data');
        $this->assertSame('scheduled', $plan['today']['state']);
        $this->assertSame('2026-11-08T09:00:00Z', $plan['today']['effectiveDueAt']);
        $this->assertNull($plan['banner']['snoozedUntil']);

        $plan = $this->putJson(route('api.v1.workspaces.crew.reminder-settings', ['demo', 'moreau']), ['enabled' => false, 'time' => '07:00'])->assertOk()->json('data');
        $this->assertSame('due', $plan['today']['state']);
        $this->assertFalse($plan['banner']['visible']);
        $this->assertSame(0, $this->unread('moreau'));

        $plan = $this->putJson(route('api.v1.workspaces.crew.reminder-settings', ['demo', 'moreau']), ['enabled' => true, 'time' => '07:00'])->assertOk()->json('data');
        $this->assertTrue($plan['banner']['visible']);
    }

    public function test_explore_clock_cannot_be_moved_and_has_no_sleep_rule(): void
    {
        $this->postJson(route('api.v1.workspaces.clock.update', 'explore'), ['minutes' => 1])->assertConflict();

        $day = $this->getJson(route('api.v1.workspaces.clock.show', 'explore'))->json('data.missionDay');

        foreach ([$day - 2, $day - 1, $day] as $missionDay) {
            $response = $this->putJson(route('api.v1.workspaces.crew.checkins.upsert', ['explore', 'okafor', $missionDay]), $this->checkin(300, 'explore', 'okafor'))->assertOk();
        }

        $this->assertSame([], $response->json('alerts'));
        $this->assertSame(0, $this->mongoCollection('alerts')->countDocuments());
        $this->assertSame(3, $this->mongoCollection('checkins')->countDocuments(['workspaceId' => 'explore']));
    }
}
