<?php

namespace App\Services\Reports;

use App\Services\Notifications\NotificationCenter;
use App\Services\Workspace\WorkspaceClock;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;
use MongoDB\Driver\Exception\Exception as MongoException;

/**
 * Persistent queue towards the ground (M06, cahier des charges p.17).
 *
 * States: local -> queued -> sending -> received | retry_available.
 * The receiver is chosen when the report is queued and kept for every retry:
 * "simulated" (Simulated ground receiver, no network) or "atlas" (the
 * MongoDB receiver behind PUT /api/v1/reports/{id}). The same UUID and the
 * same content are sent every time, so a lost acknowledgement is recovered
 * by re-sending. An Atlas failure never produces a simulated receipt.
 */
final class GroundDelivery
{
    public const string SimulatedReceiverName = 'Simulated ground receiver';

    /** @var list<string> */
    public const array Receivers = ['simulated', 'atlas'];

    private const array TypeMap = ['root' => 'array', 'document' => 'array', 'array' => 'array'];

    public function __construct(
        private readonly WorkspaceClock $clock,
        private readonly ReportBuilder $reports,
        private readonly GroundReportReceiver $atlasReceiver,
        private readonly NotificationCenter $notifications,
    ) {}

    /**
     * "Queue for ground". Sends immediately when the ground link is up.
     *
     * @return array<string, mixed>
     */
    public function queue(string $workspaceId, string $reportId, ?string $receiver = null): array
    {
        $report = $this->reports->find($workspaceId, $reportId);

        if ($report['delivery']['state'] !== 'local') {
            return $this->attempt($workspaceId, $reportId);
        }

        $link = $this->link($workspaceId);

        $this->collection()->updateOne(['_id' => $reportId], ['$set' => [
            'delivery.state' => 'queued',
            'delivery.receiver' => $receiver ?? $link['receiver'],
            'delivery.queuedAt' => new UTCDateTime($this->clock->now($workspaceId)),
        ]]);

        return $this->attempt($workspaceId, $reportId);
    }

    /**
     * One delivery attempt, if the link is up. Received reports are not resent.
     *
     * @return array<string, mixed>
     */
    public function attempt(string $workspaceId, string $reportId): array
    {
        $report = $this->reports->find($workspaceId, $reportId);
        $state = $report['delivery']['state'];

        if (in_array($state, ['local', 'received'], true) || $this->link($workspaceId)['state'] !== 'online') {
            return $report;
        }

        $receiver = $report['delivery']['receiver'];
        $now = new UTCDateTime($this->clock->now($workspaceId));
        $attempt = ['attemptId' => (string) Str::uuid(), 'at' => $now, 'receiver' => $receiver];

        $this->collection()->updateOne(['_id' => $reportId], ['$set' => ['delivery.state' => 'sending']]);

        try {
            $receipt = $receiver === 'atlas'
                ? $this->sendToAtlas($reportId, $report['payload'])
                : $this->simulatedReceipt($report, $now);
        } catch (ReportDeliveryException|MongoException $exception) {
            return $this->markRetryable($workspaceId, $report, $attempt, $exception->getMessage(), $now);
        }

        $this->collection()->updateOne(['_id' => $reportId], [
            '$set' => ['delivery.state' => 'received', 'delivery.receipt' => $receipt, 'delivery.receivedAt' => $now],
            '$push' => ['delivery.attempts' => [...$attempt, 'outcome' => 'received']],
        ]);

        $this->notifications->close($workspaceId, "report:{$reportId}:retry");
        $this->notifications->upsert($workspaceId, "report:{$reportId}:received", $report['authorId'], [
            'type' => 'ground_report_received',
            'title' => 'Ground report received',
            'body' => "Receipt from {$receipt['receiver']}.",
            'target' => ['type' => 'report', 'id' => $reportId, 'receiptId' => $receipt['receiptId']],
        ], $now);

        return $this->reports->find($workspaceId, $reportId);
    }

    /**
     * Sends every queued or retryable report of the workspace (link back up).
     *
     * @return list<array<string, mixed>>
     */
    public function flush(string $workspaceId): array
    {
        $pending = $this->collection()->find(
            ['workspaceId' => $workspaceId, 'delivery.state' => ['$in' => ['queued', 'retry_available', 'sending']]],
            ['sort' => ['delivery.queuedAt' => 1], 'projection' => ['_id' => 1]],
        );

        return array_map(fn ($report): array => $this->attempt($workspaceId, (string) $report['_id']), iterator_to_array($pending, false));
    }

    /**
     * @return array{state: string, receiver: string}
     */
    public function link(string $workspaceId): array
    {
        $link = $this->clock->workspace($workspaceId)['groundLink'] ?? [];

        return ['state' => $link['state'] ?? 'offline', 'receiver' => $link['receiver'] ?? 'simulated'];
    }

    /**
     * Simulated ground link switch. Going online flushes the queue.
     *
     * @return array{link: array{state: string, receiver: string}, flushed: list<array<string, mixed>>}
     */
    public function setLink(string $workspaceId, string $state, string $receiver): array
    {
        DB::connection('mongodb')->getCollection('workspaces')->updateOne(
            ['_id' => $workspaceId],
            ['$set' => ['groundLink' => ['state' => $state, 'receiver' => $receiver]]],
        );

        return ['link' => $this->link($workspaceId), 'flushed' => $state === 'online' ? $this->flush($workspaceId) : []];
    }

    /**
     * @param  array<string, mixed>  $payload
     * @return array<string, mixed>
     */
    private function sendToAtlas(string $reportId, array $payload): array
    {
        $outcome = $this->atlasReceiver->receive($reportId, $payload);

        if ($outcome->kind === ReceiveOutcome::Conflict) {
            throw new ReportDeliveryException('The ground receiver already holds a different report with this id (409).');
        }

        return [...$outcome->receipt, 'replayed' => $outcome->kind === ReceiveOutcome::Replayed];
    }

    /**
     * @param  array<string, mixed>  $report
     * @return array<string, mixed>
     */
    private function simulatedReceipt(array $report, UTCDateTime $now): array
    {
        return [
            'receiptId' => (string) Str::uuid(),
            'reportId' => $report['_id'],
            'receiver' => self::SimulatedReceiverName,
            'receivedAt' => $now->toDateTime()->format('Y-m-d\TH:i:s.v\Z'),
            'sha256' => $report['sha256'],
            'replayed' => false,
        ];
    }

    /**
     * @param  array<string, mixed>  $report
     * @param  array<string, mixed>  $attempt
     * @return array<string, mixed>
     */
    private function markRetryable(string $workspaceId, array $report, array $attempt, string $error, UTCDateTime $now): array
    {
        $this->collection()->updateOne(['_id' => $report['_id']], [
            '$set' => ['delivery.state' => 'retry_available', 'delivery.lastError' => $error],
            '$push' => ['delivery.attempts' => [...$attempt, 'outcome' => 'failed', 'error' => $error]],
        ]);

        $this->notifications->upsert($workspaceId, "report:{$report['_id']}:retry", $report['authorId'], [
            'type' => 'report_retry_available',
            'title' => 'Report retry available',
            'body' => 'The ground receiver did not acknowledge the report. It stays queued with the same id.',
            'target' => ['type' => 'report', 'id' => $report['_id']],
        ], $now);

        return $this->reports->find($workspaceId, $report['_id']);
    }

    private function collection(): Collection
    {
        return DB::connection('mongodb')->getCollection('report_snapshots');
    }
}
