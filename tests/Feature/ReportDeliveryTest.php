<?php

namespace Tests\Feature;

use App\Services\Demo\DemoScenario;
use App\Services\Reports\GroundDelivery;
use App\Services\Reports\GroundReportReceiver;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

class ReportDeliveryTest extends TestCase
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
    private function generate(string $subjectId, string $workspace = 'demo'): array
    {
        return $this->postJson(route('api.v1.workspaces.reports.store', $workspace), ['subjectId' => $subjectId, 'authorId' => $workspace === 'explore' ? 'ibarra' : 'haddad'])
            ->assertCreated()
            ->json('data');
    }

    private function link(string $state, string $receiver, string $workspace = 'demo'): void
    {
        $this->putJson(route('api.v1.workspaces.ground-link.update', $workspace), ['state' => $state, 'receiver' => $receiver])->assertOk();
    }

    public function test_reports_are_limited_to_their_crew_member(): void
    {
        $moreau = $this->generate('moreau');
        $sato = $this->generate('sato');

        $this->assertSame(['moreau'], array_values(array_unique(array_map(fn (string $id): string => explode('-', $id)[1], array_column($moreau['payload']['observations'], 'id')))));
        $this->assertEqualsCanonicalizing(['g/L', '%'], array_column($moreau['payload']['labResults'], 'unit'));
        $this->assertSame(13.9, collect($sato['payload']['labResults'])->firstWhere('analyte', 'hemoglobin')['value']);
        $this->assertSame('below', collect($sato['payload']['labResults'])->firstWhere('analyte', 'hemoglobin')['evaluation']['status']);

        $this->assertSame('2026-11-02T00:00:00Z', $moreau['payload']['period']['from']);
        $this->assertSame('2026-11-08T23:59:59Z', $moreau['payload']['period']['to']);
        $this->assertSame([['id' => 'SLEEP-001', 'version' => 1, 'label' => 'Demo rule']], $moreau['payload']['rules']);
        $this->assertSame('Simulated crew data', $moreau['payload']['notes']);
        $this->assertContains(['missionDay' => 142, 'field' => 'daily_checkin', 'reason' => 'no_submission'], $moreau['payload']['absences']);
        $this->assertSame('Cdr K. Moreau', $moreau['payload']['subject']['alias']);
        $this->assertSame('cmo', $moreau['payload']['author']['role']);
    }

    public function test_snapshot_does_not_change_after_a_correction(): void
    {
        $before = $this->generate('moreau');

        $this->putJson(route('api.v1.workspaces.crew.checkins.upsert', ['demo', 'moreau', 141]), [
            'status' => 'submitted', 'submittedBy' => 'moreau',
            'sleep' => ['status' => 'recorded', 'minutes' => 500],
            'sleepiness' => ['status' => 'recorded', 'value' => 2],
        ])->assertOk();

        $stored = $this->getJson(route('api.v1.workspaces.reports.show', ['demo', $before['id']]))->json('data');
        $after = $this->generate('moreau');
        $sleepOn141 = fn (array $report): int => collect($report['payload']['observations'])->first(fn (array $o): bool => $o['variable'] === 'sleep_duration' && $o['missionDay'] === 141)['value'];

        $this->assertSame($before['sha256'], $stored['sha256']);
        $this->assertSame(324, $sleepOn141($stored));
        $this->assertSame(500, $sleepOn141($after));
    }

    public function test_empty_period_says_so(): void
    {
        $report = $this->generate('okafor', 'explore');

        $this->assertSame([], $report['payload']['observations']);
        $this->assertStringContainsString('No observations in this period', $report['payload']['notes']);
        $this->assertSame([['id' => null, 'message' => 'No mission rule configured']], $report['payload']['rules']);
    }

    public function test_queue_waits_for_the_ground_link_then_the_simulated_receiver_acknowledges(): void
    {
        $report = $this->generate('moreau');

        $queued = $this->postJson(route('api.v1.workspaces.reports.queue', ['demo', $report['id']]))->assertOk()->json('data');
        $this->assertSame('queued', $queued['delivery']['state']);
        $this->assertSame([], $queued['delivery']['attempts']);

        $this->link('online', 'simulated');

        $received = $this->getJson(route('api.v1.workspaces.reports.show', ['demo', $report['id']]))->json('data');
        $this->assertSame('received', $received['delivery']['state']);
        $this->assertSame(GroundDelivery::SimulatedReceiverName, $received['delivery']['receipt']['receiver']);
        $this->assertSame($report['sha256'], $received['delivery']['receipt']['sha256']);
        $this->assertSame(0, $this->mongoCollection('reports')->countDocuments(), 'A simulated receipt never writes to the Atlas receiver.');

        $again = $this->postJson(route('api.v1.workspaces.reports.queue', ['demo', $report['id']]))->json('data');
        $this->assertSame($received['delivery']['receipt'], $again['delivery']['receipt']);

        $titles = array_column($this->getJson(route('api.v1.workspaces.crew.notifications.index', ['demo', 'haddad']))->json('data'), 'title');
        $this->assertContains('Ground report received', $titles);
    }

    public function test_atlas_receiver_stores_the_same_uuid_and_fingerprint(): void
    {
        $this->link('online', 'atlas');
        $report = $this->generate('sato');

        $received = $this->postJson(route('api.v1.workspaces.reports.queue', ['demo', $report['id']]))->assertOk()->json('data');

        $this->assertSame('received', $received['delivery']['state']);
        $this->assertSame('MongoDB Atlas ground receiver', $received['delivery']['receipt']['receiver']);
        $this->assertSame($report['sha256'], $received['delivery']['receipt']['sha256']);
        $this->assertSame($report['id'], $this->mongoCollection('reports')->findOne(['_id' => $report['id']])['_id']);
    }

    public function test_lost_acknowledgement_is_recovered_with_the_initial_receipt(): void
    {
        $report = $this->generate('moreau');
        $stored = $this->mongoCollection('report_snapshots')->findOne(['_id' => $report['id']], ['typeMap' => ['root' => 'array', 'document' => 'array', 'array' => 'array']]);
        $firstReceipt = app(GroundReportReceiver::class)->receive($report['id'], $stored['payload'])->receipt;

        $this->link('online', 'atlas');
        $received = $this->postJson(route('api.v1.workspaces.reports.queue', ['demo', $report['id']]))->json('data');

        $this->assertSame('received', $received['delivery']['state']);
        $this->assertTrue($received['delivery']['receipt']['replayed']);
        $this->assertSame($firstReceipt['receiptId'], $received['delivery']['receipt']['receiptId']);
        $this->assertSame(1, $this->mongoCollection('reports')->countDocuments());
    }

    public function test_atlas_outage_leaves_a_retryable_report_without_receipt(): void
    {
        $this->link('online', 'atlas');
        $report = $this->generate('moreau');
        $workingGround = config('database.connections.ground');

        config([
            'database.connections.ground.dsn' => 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=300&connectTimeoutMS=300',
            'database.connections.ground.options' => ['serverSelectionTimeoutMS' => 300, 'connectTimeoutMS' => 300],
        ]);
        DB::purge('ground');

        $failed = $this->postJson(route('api.v1.workspaces.reports.queue', ['demo', $report['id']]))->assertOk()->json('data');

        $this->assertSame('retry_available', $failed['delivery']['state']);
        $this->assertNull($failed['delivery']['receipt']);
        $this->assertSame('atlas', $failed['delivery']['receiver']);
        $this->assertContains('Report retry available', array_column($this->getJson(route('api.v1.workspaces.crew.notifications.index', ['demo', 'haddad']))->json('data'), 'title'));

        config(['database.connections.ground' => $workingGround]);
        DB::purge('ground');

        $retried = $this->postJson(route('api.v1.workspaces.reports.send', ['demo', $report['id']]))->assertOk()->json('data');

        $this->assertSame('received', $retried['delivery']['state']);
        $this->assertSame('MongoDB Atlas ground receiver', $retried['delivery']['receipt']['receiver']);
        $this->assertSame(['failed', 'received'], array_column($retried['delivery']['attempts'], 'outcome'));
        $retryNotice = $this->mongoCollection('notifications')->findOne(['eventKey' => "report:{$report['id']}:retry"]);
        $this->assertFalse($retryNotice['active'], 'The retry notice is closed once the report is received.');
    }

    public function test_demo_reset_only_touches_the_demo_workspace(): void
    {
        $this->generate('moreau');
        $this->generate('okafor', 'explore');
        $this->postJson(route('api.v1.workspaces.clock.update', 'demo'), ['minutes' => 120])->assertOk();

        $this->postJson(route('api.v1.demo.reset'))->assertOk()->assertJsonPath('data.clock.now', '2026-11-08T06:59:00Z');

        $this->assertSame(0, $this->mongoCollection('report_snapshots')->countDocuments(['workspaceId' => 'demo']));
        $this->assertSame(1, $this->mongoCollection('report_snapshots')->countDocuments(['workspaceId' => 'explore']));
    }
}
