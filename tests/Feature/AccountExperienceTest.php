<?php

namespace Tests\Feature;

use App\Models\CrewCase;
use App\Models\CrewReport;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Tests\TestCase;

class AccountExperienceTest extends TestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();
    }

    private function profile(string $role = 'astronaut', string $mission = 'test-mission'): User
    {
        return User::factory()->create(['role' => $role, 'mission_id' => $mission]);
    }

    private function checkin(): array
    {
        return ['id' => (string) Str::uuid(), 'kind' => 'check-in', 'sleep_hours' => 7, 'sleep_minutes' => 15, 'drowsiness' => 4];
    }

    public function test_guest_can_open_demo_but_connected_records_require_authentication(): void
    {
        $this->get('/')->assertOk();
        $this->get('/symptoms')->assertOk();
        $this->get('/account')->assertRedirect('/login');
        $this->post('/account/cases', $this->checkin())->assertRedirect('/login');
    }

    public function test_login_uses_account_role_and_mission_and_logout_ends_access(): void
    {
        $user = $this->profile();
        $this->post('/login', ['email' => $user->email, 'password' => 'incorrect'])->assertSessionHasErrors('email');
        $this->post('/login', ['email' => $user->email, 'password' => 'password', 'role' => 'cmo', 'mission_id' => 'forged'])->assertRedirect('/account');
        $this->assertAuthenticatedAs($user);
        $this->get('/account')->assertOk()->assertSee('ASTRONAUT')->assertSee('test-mission')->assertHeader('Cache-Control', 'no-store, private');
        $this->get('/account/reviews')->assertForbidden();
        $this->post('/logout')->assertRedirect('/');
        $this->assertGuest();
    }

    public function test_unassigned_accounts_have_no_crew_access(): void
    {
        $this->actingAs(User::factory()->create())->get('/account')->assertForbidden();
    }

    public function test_astronaut_submission_is_idempotent_and_cannot_set_ownership_or_review(): void
    {
        $user = $this->profile();
        $input = $this->checkin();
        $this->actingAs($user)->post('/account/cases', $input + ['mission_id' => 'forged', 'user_id' => 900, 'status' => 'reviewed'])->assertRedirect('/account/cases/'.$input['id']);
        $case = CrewCase::findOrFail($input['id']);
        $this->assertSame($user->id, $case->user_id);
        $this->assertSame('test-mission', $case->mission_id);
        $this->assertSame('submitted', $case->status);
        $this->post('/account/cases', $input)->assertRedirect('/account/cases/'.$case->id);
        $this->assertDatabaseCount('crew_cases', 1);
        $this->patch('/account/cases/'.$case->id, ['action' => 'review', 'text' => 'Forged review'])->assertSessionHasErrors('action');
        $this->post('/account/reports', ['crew_id' => $user->id])->assertForbidden();
    }

    public function test_medical_review_followup_and_response_return_to_the_same_record(): void
    {
        $astronaut = $this->profile();
        $cmo = $this->profile('cmo');
        $input = $this->checkin();
        $this->actingAs($astronaut)->post('/account/cases', $input);
        $url = '/account/cases/'.$input['id'];
        $this->actingAs($cmo)->get('/account')->assertOk()->assertSee('Review queue')->assertSee($astronaut->name);
        $this->patch($url, ['action' => 'follow-up', 'text' => 'Please clarify sleep duration.', 'field' => 'sleep'])->assertRedirect();
        $this->actingAs($astronaut)->get('/account')->assertSee('Respond to follow-up');
        $this->get($url)->assertSee('Please clarify sleep duration.')->assertSee('Respond to follow-up');
        $this->patch($url, ['action' => 'reply', 'text' => 'Seven hours, without naps.'])->assertRedirect();
        $this->actingAs($cmo)->get($url)->assertSee('Response received')->assertSee('Seven hours, without naps.');
        $this->patch($url, ['action' => 'review', 'text' => 'Reviewed with the crew member.'])->assertRedirect();
        $this->assertSame('reviewed', CrewCase::find($input['id'])->status);
        $this->assertCount(3, CrewCase::find($input['id'])->thread);
    }

    public function test_other_crew_and_other_missions_cannot_read_or_change_a_record(): void
    {
        $astronaut = $this->profile();
        $input = $this->checkin();
        $this->actingAs($astronaut)->post('/account/cases', $input);
        $url = '/account/cases/'.$input['id'];
        foreach ([$this->profile(), $this->profile('cmo', 'other-mission')] as $other) {
            $this->actingAs($other)->get($url)->assertNotFound();
            $this->get($url.'/photo')->assertNotFound();
            $this->patch($url, ['action' => 'follow-up', 'text' => 'Access attempt'])->assertNotFound();
            $this->post('/account/cases', $input)->assertStatus($other->role === 'cmo' ? 403 : 404);
            $this->get('/account/trends')->assertDontSee($astronaut->name);
        }
    }

    public function test_invalid_checkin_and_photo_are_rejected(): void
    {
        $this->actingAs($this->profile());
        $this->post('/account/cases', ['id' => (string) Str::uuid(), 'kind' => 'check-in'])->assertSessionHasErrors(['sleep_hours', 'sleep_minutes', 'drowsiness']);
        $this->post('/account/cases', array_replace($this->checkin(), ['sleep_hours' => 24, 'sleep_minutes' => 1]))->assertSessionHasErrors('sleep_hours');
        $this->post('/account/cases', ['id' => (string) Str::uuid(), 'kind' => 'symptom', 'description' => 'Red mark', 'body_area' => 'Left arm', 'noticed_at' => now()->subMinute()->toIso8601String(), 'photo_id' => (string) Str::uuid(), 'photo' => UploadedFile::fake()->create('bad.svg', 2, 'image/svg+xml')])->assertSessionHasErrors('photo');
        $this->assertDatabaseCount('crew_cases', 0);
    }

    public function test_photo_is_private_and_only_the_assigned_crew_and_cmo_can_fetch_it(): void
    {
        Storage::fake('local');
        $astronaut = $this->profile();
        $png = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=');
        $input = ['id' => (string) Str::uuid(), 'kind' => 'symptom', 'description' => 'A small red patch', 'body_area' => 'Left arm', 'noticed_at' => now()->subMinute()->toIso8601String(), 'photo_id' => (string) Str::uuid(), 'photo' => UploadedFile::fake()->createWithContent('patch.png', $png)];
        $this->actingAs($astronaut)->post('/account/cases', $input)->assertRedirect('/account/cases/'.$input['id']);
        $case = CrewCase::findOrFail($input['id']);
        Storage::disk('local')->assertExists($case->photo_path);
        $this->actingAs($this->profile('cmo'))->get('/account/cases/'.$case->id.'/photo')->assertOk()->assertHeader('Cache-Control', 'no-store, private');
        $this->actingAs($this->profile())->get('/account/cases/'.$case->id.'/photo')->assertNotFound();
    }

    public function test_connected_reports_have_private_mission_scope_and_an_honest_ground_state(): void
    {
        $astronaut = $this->profile();
        $this->actingAs($astronaut)->post('/account/cases', $this->checkin());
        $cmo = $this->profile('cmo');
        $this->actingAs($cmo)->post('/account/reports', ['crew_id' => $astronaut->id])->assertRedirect('/account/reports');
        $report = CrewReport::firstOrFail();
        $this->assertSame('not-queued', $report->status);
        $this->assertArrayNotHasKey('photo_path', $report->snapshot['cases'][0]);
        $this->actingAs($this->profile('cmo', 'other-mission'))->post('/account/reports/'.$report->id.'/queue')->assertNotFound();
        $this->actingAs($cmo)->post('/account/reports/'.$report->id.'/queue')->assertRedirect('/account/transmission');
        $this->get('/account/transmission')->assertSee('Queued for ground')->assertSee('no configured ground receiver');
        $this->assertSame('queued', $report->fresh()->status);
    }

    public function test_connected_pages_render_and_user_text_is_escaped(): void
    {
        $user = $this->profile();
        $this->actingAs($user);
        foreach (['today', 'check-in', 'symptoms', 'trends', 'body', 'follow-up'] as $page) {
            $this->get('/account/'.$page)->assertOk();
        }
        $id = (string) Str::uuid();
        $this->post('/account/cases', ['id' => $id, 'kind' => 'symptom', 'description' => '<script>alert(1)</script>', 'body_area' => 'Other', 'noticed_at' => now()->subMinute()->toIso8601String()]);
        $this->get('/account/cases/'.$id)->assertSee('&lt;script&gt;alert(1)&lt;/script&gt;', false)->assertDontSee('<script>alert(1)</script>', false);
    }
}
