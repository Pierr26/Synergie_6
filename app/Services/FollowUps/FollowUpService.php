<?php

namespace App\Services\FollowUps;

use App\Services\Notifications\NotificationCenter;
use App\Services\Workspace\WorkspaceClock;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;

/**
 * Traceable onboard follow-up (M04, M15, cahier des charges p.6-7 et p.12).
 *
 * - review_request: an astronaut asks the CMO to review a reading or symptom.
 * - follow_up_request: the CMO asks an astronaut for a new check-in or measurement.
 * Each response has its own id, author and time. Reading a notification
 * leaves the request open; only a response or a CMO closure changes it.
 * Nothing here is sent to the ground automatically (recette V12).
 */
final class FollowUpService
{
    private const array TypeMap = ['root' => 'array', 'document' => 'array', 'array' => 'array'];

    public function __construct(
        private readonly WorkspaceClock $clock,
        private readonly NotificationCenter $notifications,
    ) {}

    /**
     * @param  array{type: string, authorId: string, subjectId: string, reason: string, requested?: ?array<string, mixed>, evidence?: ?array<string, mixed>, dueAt?: ?string, clientRequestId?: ?string}  $input
     * @return array{followUp: array<string, mixed>, created: bool}
     */
    public function open(string $workspaceId, array $input): array
    {
        $followUpId = $input['clientRequestId'] ?? (string) Str::uuid();
        $existing = $this->collection()->findOne(['_id' => $followUpId, 'workspaceId' => $workspaceId], ['typeMap' => self::TypeMap]);

        if ($existing !== null) {
            return ['followUp' => $existing, 'created' => false];
        }

        $now = new UTCDateTime($this->clock->now($workspaceId));
        $isReview = $input['type'] === 'review_request';
        $recipients = $isReview ? $this->cmoIds($workspaceId) : [$input['subjectId']];

        $this->collection()->insertOne([
            '_id' => $followUpId,
            'workspaceId' => $workspaceId,
            'type' => $input['type'],
            'origin' => 'crew',
            'authorId' => $input['authorId'],
            'subjectId' => $input['subjectId'],
            'targetRole' => $isReview ? 'cmo' : 'astronaut',
            'targetId' => $recipients[0] ?? null,
            'priority' => 'cmo_review',
            'status' => 'open',
            'reason' => $input['reason'],
            'requested' => $input['requested'] ?? null,
            'evidence' => $input['evidence'] ?? null,
            'dueAt' => isset($input['dueAt']) ? new UTCDateTime(CarbonImmutable::parse($input['dueAt'])) : null,
            'missionDay' => $this->clock->missionDay($workspaceId),
            'responses' => [],
            'createdAt' => $now,
        ]);

        foreach ($recipients as $recipientId) {
            $this->notifications->upsert($workspaceId, "follow_up:{$followUpId}:open", $recipientId, [
                'type' => $isReview ? 'crew_review_requested' : 'follow_up_requested',
                'title' => $isReview ? 'Crew review requested' : 'New follow-up request',
                'body' => $input['reason'],
                'target' => ['type' => 'follow_up', 'id' => $followUpId],
                'priority' => 'cmo_review',
            ], $now);
        }

        return ['followUp' => $this->find($workspaceId, $followUpId), 'created' => true];
    }

    /**
     * @param  array{responderId: string, message: string, checkinId?: ?string, observationIds?: list<string>, responseId?: ?string}  $input
     * @return array<string, mixed>
     */
    public function respond(string $workspaceId, string $followUpId, array $input): array
    {
        $followUp = $this->find($workspaceId, $followUpId);

        if ($followUp['status'] === 'closed') {
            throw new FollowUpException('This request is closed.');
        }

        $allowed = $followUp['type'] === 'review_request' ? $this->cmoIds($workspaceId) : [$followUp['subjectId']];

        if (! in_array($input['responderId'], $allowed, true)) {
            throw new FollowUpException('Only the addressee of the request can answer it.');
        }

        $responseId = $input['responseId'] ?? (string) Str::uuid();

        if (in_array($responseId, array_column($followUp['responses'], 'responseId'), true)) {
            return $followUp;
        }

        $now = new UTCDateTime($this->clock->now($workspaceId));

        $this->collection()->updateOne(['_id' => $followUpId], [
            '$push' => ['responses' => [
                'responseId' => $responseId,
                'responderId' => $input['responderId'],
                'message' => $input['message'],
                'checkinId' => $input['checkinId'] ?? null,
                'observationIds' => $input['observationIds'] ?? [],
                'respondedAt' => $now,
            ]],
            '$set' => ['status' => 'answered', 'answeredAt' => $now],
        ]);

        $this->notifications->close($workspaceId, "follow_up:{$followUpId}:open");
        $this->notifications->upsert($workspaceId, "follow_up:{$followUpId}:answered:{$responseId}", $followUp['authorId'], [
            'type' => 'follow_up_completed',
            'title' => 'Follow-up completed',
            'body' => $input['message'],
            'target' => ['type' => 'follow_up', 'id' => $followUpId, 'checkinId' => $input['checkinId'] ?? null],
        ], $now);

        return $this->find($workspaceId, $followUpId);
    }

    /**
     * @return array<string, mixed>
     */
    public function close(string $workspaceId, string $followUpId, string $cmoId, ?string $note): array
    {
        $this->find($workspaceId, $followUpId);

        $this->collection()->updateOne(['_id' => $followUpId], ['$set' => [
            'status' => 'closed',
            'closedBy' => $cmoId,
            'closingNote' => $note,
            'closedAt' => new UTCDateTime($this->clock->now($workspaceId)),
        ]]);

        $this->notifications->close($workspaceId, "follow_up:{$followUpId}:open", 'closed');

        return $this->find($workspaceId, $followUpId);
    }

    /**
     * @param  array{crewId?: ?string, status?: ?string}  $filters
     * @return list<array<string, mixed>>
     */
    public function list(string $workspaceId, array $filters = []): array
    {
        return iterator_to_array($this->collection()->find(array_filter([
            'workspaceId' => $workspaceId,
            'subjectId' => $filters['crewId'] ?? null,
            'status' => $filters['status'] ?? null,
        ]), ['sort' => ['createdAt' => -1, '_id' => 1], 'limit' => 200, 'typeMap' => self::TypeMap]), false);
    }

    /**
     * @return array<string, mixed>
     */
    public function find(string $workspaceId, string $followUpId): array
    {
        $followUp = $this->collection()->findOne(['_id' => $followUpId, 'workspaceId' => $workspaceId], ['typeMap' => self::TypeMap]);

        abort_if($followUp === null, 404, 'Follow-up not found in this workspace.');

        return $followUp;
    }

    /**
     * @return list<string>
     */
    private function cmoIds(string $workspaceId): array
    {
        $cursor = DB::connection('mongodb')->getCollection('crew_members')->find(['workspaceId' => $workspaceId, 'role' => 'cmo'], ['sort' => ['crewId' => 1]]);

        return array_map(fn ($member): string => $member['crewId'], iterator_to_array($cursor, false));
    }

    private function collection(): Collection
    {
        return DB::connection('mongodb')->getCollection('follow_ups');
    }
}
