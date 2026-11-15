<?php

namespace App\Services\Notifications;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;

/**
 * Role-filtered notification inbox (M15), written idempotently: one entry
 * per (workspace, eventKey, recipient). Refreshing an existing entry can
 * make it unread again once, for instance when a snoozed reminder comes due.
 */
final class NotificationCenter
{
    private const array TypeMap = ['root' => 'array', 'document' => 'array', 'array' => 'array'];

    /**
     * @param  array{type: string, title: string, body: string, target: array<string, mixed>, priority?: string}  $content
     * @return array<string, mixed>
     */
    public function upsert(string $workspaceId, string $eventKey, string $recipientId, array $content, UTCDateTime $at, bool $markUnread = false): array
    {
        $update = [
            '$setOnInsert' => ['_id' => (string) Str::uuid(), 'createdAt' => $at, 'readAt' => null],
            '$set' => [...$content, 'updatedAt' => $at, 'actionState' => 'open', 'active' => true],
        ];

        if ($markUnread) {
            unset($update['$setOnInsert']['readAt']);
            $update['$set']['readAt'] = null;
        }

        $this->collection()->updateOne(
            ['workspaceId' => $workspaceId, 'eventKey' => $eventKey, 'recipientId' => $recipientId],
            $update,
            ['upsert' => true],
        );

        return $this->collection()->findOne(['workspaceId' => $workspaceId, 'eventKey' => $eventKey, 'recipientId' => $recipientId], ['typeMap' => self::TypeMap]);
    }

    /**
     * Ends the action of an entry (it stays in history).
     */
    public function close(string $workspaceId, string $eventKey, string $actionState = 'done'): void
    {
        $this->collection()->updateMany(
            ['workspaceId' => $workspaceId, 'eventKey' => $eventKey],
            ['$set' => ['actionState' => $actionState, 'active' => false]],
        );
    }

    /**
     * Hides an entry from the bell without marking it done (reminders disabled).
     */
    public function deactivate(string $workspaceId, string $eventKey): void
    {
        $this->collection()->updateMany(['workspaceId' => $workspaceId, 'eventKey' => $eventKey], ['$set' => ['active' => false]]);
    }

    /**
     * @return array{unreadActive: int, items: list<array<string, mixed>>}
     */
    public function inbox(string $workspaceId, string $recipientId, int $limit = 50): array
    {
        $filter = ['workspaceId' => $workspaceId, 'recipientId' => $recipientId];

        return [
            'unreadActive' => $this->collection()->countDocuments([...$filter, 'readAt' => null, 'active' => true]),
            'items' => iterator_to_array($this->collection()->find($filter, [
                'sort' => ['updatedAt' => -1, '_id' => 1],
                'limit' => $limit,
                'typeMap' => self::TypeMap,
            ]), false),
        ];
    }

    public function markRead(string $workspaceId, string $notificationId, UTCDateTime $at): bool
    {
        return $this->collection()->updateOne(
            ['_id' => $notificationId, 'workspaceId' => $workspaceId, 'readAt' => null],
            ['$set' => ['readAt' => $at]],
        )->getMatchedCount() > 0
            || $this->collection()->countDocuments(['_id' => $notificationId, 'workspaceId' => $workspaceId]) > 0;
    }

    private function collection(): Collection
    {
        return DB::connection('mongodb')->getCollection('notifications');
    }
}
