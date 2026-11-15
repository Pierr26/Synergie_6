<?php

namespace App\Services\Reports;

use App\Support\CanonicalJson;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;
use MongoDB\Driver\Exception\BulkWriteException;

/**
 * Ground receiver contract (cahier des charges p.17 et p.21).
 *
 * - The snapshot is validated, fingerprinted and stored before any receipt.
 * - _id = reportId, payload, fingerprint and receipt live in one document.
 * - Same UUID + same canonical content returns the initial receipt.
 * - Same UUID + different content is a conflict (409).
 * - A database failure propagates: no receipt is ever invented.
 */
final class GroundReportReceiver
{
    private const int DuplicateKeyCode = 11000;

    /** Workspace labels written by the web app in its report snapshots. */
    private const array WorkspaceLabels = ['Guided demo' => 'demo', 'Explore app' => 'explore'];

    public function __construct(private readonly string $receiverName) {}

    /**
     * Structured report (HEXTA API delivery queue).
     *
     * @param  array<string, mixed>  $payload
     */
    public function receive(string $reportId, array $payload): ReceiveOutcome
    {
        return $this->store($reportId, CanonicalJson::sha256($payload), CanonicalJson::encode($payload), $payload, [
            'workspaceId' => $payload['workspaceId'] ?? null,
            'missionId' => $payload['missionId'] ?? null,
            'subjectCrewId' => $payload['subject']['crewId'] ?? null,
        ]);
    }

    /**
     * Frozen snapshot sent by the web app as a canonical JSON string. The fingerprint is the SHA-256 of that exact
     * string, the same value the browser computed, so the receipt can be checked on board.
     */
    public function receiveSnapshot(string $reportId, string $content): ReceiveOutcome
    {
        $decoded = json_decode($content, true);
        $decoded = is_array($decoded) ? $decoded : [];

        $workspaceLabel = is_string($decoded['workspace'] ?? null) ? $decoded['workspace'] : null;

        return $this->store($reportId, hash('sha256', $content), $content, $decoded, [
            'workspaceId' => $decoded['workspaceId'] ?? self::WorkspaceLabels[$workspaceLabel] ?? null,
            'missionId' => $decoded['missionId'] ?? $decoded['mission']['id'] ?? null,
            'subjectCrewId' => $decoded['subject']['crewId'] ?? $decoded['member']['id'] ?? null,
        ]);
    }

    /**
     * Inserts with _id = reportId: a duplicate key means the report was already received, and the stored
     * fingerprint decides between a replay and a conflict.
     *
     * @param  array<string, mixed>  $payload
     * @param  array{workspaceId: ?string, missionId: ?string, subjectCrewId: ?string}  $index
     */
    private function store(string $reportId, string $sha256, string $canonical, array $payload, array $index): ReceiveOutcome
    {
        $receivedAt = now('UTC');

        $receipt = [
            'receiptId' => (string) Str::uuid(),
            'reportId' => $reportId,
            'receiver' => $this->receiverName,
            'receivedAt' => $receivedAt->toIso8601ZuluString('millisecond'),
            'sha256' => $sha256,
        ];

        try {
            $this->collection()->insertOne([
                '_id' => $reportId,
                ...$index,
                'sha256' => $sha256,
                'canonical' => $canonical,
                'payload' => $payload,
                'receipt' => $receipt,
                'receivedAt' => new UTCDateTime($receivedAt),
            ]);
        } catch (BulkWriteException $exception) {
            if (! $this->isDuplicateKey($exception)) {
                throw $exception;
            }

            return $this->compareWithStored($reportId, $sha256);
        }

        return new ReceiveOutcome(ReceiveOutcome::Created, $receipt);
    }

    /**
     * @return array{receiptId: string, reportId: string, receiver: string, receivedAt: string, sha256: string}|null
     */
    public function receiptFor(string $reportId): ?array
    {
        $document = $this->collection()->findOne(
            ['_id' => $reportId],
            ['projection' => ['receipt' => 1], 'typeMap' => ['root' => 'array', 'document' => 'array', 'array' => 'array']],
        );

        return $document['receipt'] ?? null;
    }

    private function compareWithStored(string $reportId, string $submittedSha256): ReceiveOutcome
    {
        $document = $this->collection()->findOne(
            ['_id' => $reportId],
            ['projection' => ['sha256' => 1, 'receipt' => 1], 'typeMap' => ['root' => 'array', 'document' => 'array', 'array' => 'array']],
        );

        $kind = $document['sha256'] === $submittedSha256 ? ReceiveOutcome::Replayed : ReceiveOutcome::Conflict;

        return new ReceiveOutcome($kind, $document['receipt'], $submittedSha256);
    }

    private function isDuplicateKey(BulkWriteException $exception): bool
    {
        foreach ($exception->getWriteResult()->getWriteErrors() as $error) {
            if ($error->getCode() === self::DuplicateKeyCode) {
                return true;
            }
        }

        return false;
    }

    private function collection(): Collection
    {
        return DB::connection('ground')->getCollection('reports');
    }
}
