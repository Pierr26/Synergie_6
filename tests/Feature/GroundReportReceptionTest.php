<?php

namespace Tests\Feature;

use App\Services\Reports\GroundReportReceiver;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

class GroundReportReceptionTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->freshMongoDatabase();
    }

    /**
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    private function reportPayload(string $reportId, array $overrides = []): array
    {
        return array_replace_recursive([
            'reportId' => $reportId,
            'schemaVersion' => 1,
            'workspaceId' => 'demo',
            'missionId' => 'QN-LO-03',
            'simulated' => true,
            'subject' => ['crewId' => 'moreau', 'alias' => 'Cdr K. Moreau'],
            'author' => ['crewId' => 'haddad', 'alias' => 'Dr A. Haddad', 'role' => 'cmo'],
            'period' => ['from' => '2026-11-02T00:00:00Z', 'to' => '2026-11-08T23:59:59Z'],
            'generatedAt' => '2026-11-08T07:20:00Z',
            'missionDay' => 142,
            'timezone' => 'UTC',
            'observations' => [
                ['variable' => 'sleep_duration', 'missionDay' => 140, 'value' => 336, 'unit' => 'min', 'method' => 'sleep_diary'],
                ['variable' => 'sleep_duration', 'missionDay' => 141, 'value' => 324, 'unit' => 'min', 'method' => 'sleep_diary'],
                ['variable' => 'sleep_duration', 'missionDay' => 142, 'value' => 312, 'unit' => 'min', 'method' => 'sleep_diary'],
            ],
            'absences' => [],
            'labResults' => [['analyte' => 'hemoglobin', 'value' => 152, 'unit' => 'g/L', 'interval' => 'within']],
            'reviews' => [],
            'followUps' => [],
            'rules' => [['id' => 'SLEEP-001', 'version' => 1, 'label' => 'Demo rule']],
        ], $overrides);
    }

    public function test_first_reception_stores_the_snapshot_and_returns_a_receipt(): void
    {
        $reportId = (string) Str::uuid();

        $response = $this->putJson(route('api.v1.reports.update', $reportId), $this->reportPayload($reportId));

        $response->assertCreated()
            ->assertJsonPath('status', 'received')
            ->assertJsonPath('replayed', false)
            ->assertJsonPath('receipt.reportId', $reportId)
            ->assertJsonPath('receipt.receiver', 'MongoDB Atlas ground receiver');

        $stored = $this->mongoCollection('reports')->findOne(['_id' => $reportId]);

        $this->assertNotNull($stored);
        $this->assertSame($response->json('receipt.sha256'), $stored['sha256']);
        $this->assertSame($response->json('receipt.receiptId'), $stored['receipt']['receiptId']);
        $this->assertSame('moreau', $stored['subjectCrewId']);
    }

    public function test_identical_resend_returns_the_initial_receipt(): void
    {
        $reportId = (string) Str::uuid();
        $payload = $this->reportPayload($reportId);

        $first = $this->putJson(route('api.v1.reports.update', $reportId), $payload);

        $reordered = array_reverse($payload, preserve_keys: true);
        $second = $this->putJson(route('api.v1.reports.update', $reportId), $reordered);

        $second->assertOk()->assertJsonPath('replayed', true);
        $this->assertSame($first->json('receipt'), $second->json('receipt'));
        $this->assertSame(1, $this->mongoCollection('reports')->countDocuments());
    }

    public function test_same_id_with_different_content_is_a_conflict(): void
    {
        $reportId = (string) Str::uuid();
        $this->putJson(route('api.v1.reports.update', $reportId), $this->reportPayload($reportId))->assertCreated();

        $altered = $this->reportPayload($reportId, ['notes' => 'Edited after queueing']);
        $response = $this->putJson(route('api.v1.reports.update', $reportId), $altered);

        $response->assertConflict()->assertJsonStructure(['message', 'reportId', 'storedSha256', 'submittedSha256']);
        $this->assertNotSame($response->json('storedSha256'), $response->json('submittedSha256'));
        $this->assertArrayNotHasKey('notes', (array) $this->mongoCollection('reports')->findOne(['_id' => $reportId])['payload']);
    }

    public function test_receipt_survives_a_restart_and_can_be_read_after_a_lost_acknowledgement(): void
    {
        $reportId = (string) Str::uuid();
        $first = $this->putJson(route('api.v1.reports.update', $reportId), $this->reportPayload($reportId));

        $this->app->forgetInstance(GroundReportReceiver::class);
        DB::purge('mongodb');

        $this->getJson(route('api.v1.reports.receipt', $reportId))
            ->assertOk()
            ->assertJsonPath('receipt', $first->json('receipt'));
    }

    public function test_unknown_receipt_returns_not_found(): void
    {
        $this->getJson(route('api.v1.reports.receipt', (string) Str::uuid()))->assertNotFound();
    }

    public function test_body_report_id_must_match_the_url(): void
    {
        $reportId = (string) Str::uuid();

        $this->putJson(route('api.v1.reports.update', $reportId), $this->reportPayload((string) Str::uuid()))
            ->assertUnprocessable()
            ->assertJsonValidationErrors('reportId');
    }

    public function test_unknown_workspace_and_missing_sections_are_rejected(): void
    {
        $reportId = (string) Str::uuid();
        $payload = $this->reportPayload($reportId, ['workspaceId' => 'other']);
        unset($payload['labResults']);

        $this->putJson(route('api.v1.reports.update', $reportId), $payload)
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['workspaceId', 'labResults']);

        $this->assertSame(0, $this->mongoCollection('reports')->countDocuments());
    }

    public function test_non_uuid_report_id_is_not_routed(): void
    {
        $this->putJson('/api/v1/reports/not-a-uuid', [])->assertNotFound();
    }

    public function test_unavailable_database_returns_503_without_receipt(): void
    {
        config([
            'database.connections.ground.dsn' => 'mongodb://127.0.0.1:1/?serverSelectionTimeoutMS=300&connectTimeoutMS=300',
            'database.connections.ground.options' => ['serverSelectionTimeoutMS' => 300, 'connectTimeoutMS' => 300],
        ]);
        DB::purge('ground');
        $this->app->forgetInstance(GroundReportReceiver::class);

        $reportId = (string) Str::uuid();

        $this->putJson(route('api.v1.reports.update', $reportId), $this->reportPayload($reportId))
            ->assertServiceUnavailable()
            ->assertJsonPath('retryable', true)
            ->assertJsonMissingPath('receipt');
    }

    public function test_health_endpoint_reports_database_state(): void
    {
        $this->getJson(route('api.v1.health'))
            ->assertOk()
            ->assertJsonPath('database', 'ok')
            ->assertJsonPath('receiver', 'MongoDB Atlas ground receiver');
    }
}
