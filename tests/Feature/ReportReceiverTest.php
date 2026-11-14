<?php

namespace Tests\Feature;

use App\Models\ReceivedReport;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

class ReportReceiverTest extends TestCase
{
    use RefreshDatabase;

    /**
     * @return array{content: string}
     */
    private function payload(string $reportId, string $note = 'Sleep trend reviewed'): array
    {
        return ['content' => json_encode([
            'reportId' => $reportId,
            'member' => ['alias' => 'K. Moreau'],
            'period' => ['fromDay' => 136, 'toDay' => 142],
            'generatedAt' => '2026-11-08T08:10:00Z',
            'author' => 'Dr A. Haddad',
            'note' => $note,
        ])];
    }

    public function test_first_put_stores_the_snapshot_and_returns_a_receipt(): void
    {
        $id = (string) Str::uuid();

        $response = $this->putJson("/api/v1/reports/{$id}", $this->payload($id));

        $response->assertCreated()
            ->assertJsonPath('reportId', $id)
            ->assertJsonPath('receiver', 'Laravel test receiver')
            ->assertJsonPath('replayed', false);
        $this->assertDatabaseHas('received_reports', ['report_id' => $id]);
    }

    public function test_same_uuid_and_same_content_returns_the_original_receipt(): void
    {
        $id = (string) Str::uuid();
        $first = $this->putJson("/api/v1/reports/{$id}", $this->payload($id))->json();

        $second = $this->putJson("/api/v1/reports/{$id}", $this->payload($id));

        $second->assertOk()
            ->assertJsonPath('receiptId', $first['receiptId'])
            ->assertJsonPath('receivedAt', $first['receivedAt'])
            ->assertJsonPath('replayed', true);
        $this->assertSame(1, ReceivedReport::query()->count());
    }

    public function test_same_uuid_with_different_content_is_a_conflict(): void
    {
        $id = (string) Str::uuid();
        $this->putJson("/api/v1/reports/{$id}", $this->payload($id))->assertCreated();

        $this->putJson("/api/v1/reports/{$id}", $this->payload($id, 'Edited later'))->assertStatus(409);
    }

    public function test_snapshot_must_match_the_url_uuid_and_carry_required_fields(): void
    {
        $id = (string) Str::uuid();

        $this->putJson("/api/v1/reports/{$id}", $this->payload((string) Str::uuid()))->assertUnprocessable();
        $this->putJson("/api/v1/reports/{$id}", ['content' => json_encode(['reportId' => $id])])->assertUnprocessable();
        $this->putJson('/api/v1/reports/not-a-uuid', $this->payload('not-a-uuid'))->assertNotFound();
    }

    public function test_the_receipt_survives_a_restart_because_it_is_persisted(): void
    {
        $id = (string) Str::uuid();
        $first = $this->putJson("/api/v1/reports/{$id}", $this->payload($id))->json();

        $stored = ReceivedReport::query()->findOrFail($id);

        $this->assertSame($first['receiptId'], $stored->receipt_id);
    }
}
