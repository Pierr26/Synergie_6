<?php

namespace App\Services\Reminders;

use App\Services\Notifications\NotificationCenter;
use App\Services\Workspace\WorkspaceClock;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;

/**
 * Daily check-in reminder (M14, cahier des charges p.5, recette V09).
 *
 * The state is recomputed from stored facts on every call (open, foreground,
 * due time), using the workspace clock:
 *   scheduled -> due -> (snoozed -> due) -> completed, or missed the next day.
 * One task per workspace, mission, crew member, day and type (unique key).
 */
final class ReminderEngine
{
    public const string Type = 'daily_checkin';

    private const array TypeMap = ['root' => 'array', 'document' => 'array', 'array' => 'array'];

    public function __construct(
        private readonly WorkspaceClock $clock,
        private readonly NotificationCenter $notifications,
    ) {}

    /**
     * @return array{clock: array<string, mixed>, today: array<string, mixed>, banner: array<string, mixed>, history: list<array<string, mixed>>}
     */
    public function plan(string $workspaceId, string $crewId): array
    {
        $now = $this->clock->now($workspaceId);
        $today = $this->clock->missionDay($workspaceId, $now);
        $settings = $this->settings($workspaceId, $crewId);

        $this->markPreviousDaysMissed($workspaceId, $crewId, $today);
        $task = $this->refreshDay($workspaceId, $crewId, $today, $now, $settings);

        return [
            'clock' => $this->clock->describe($workspaceId),
            'today' => $task,
            'banner' => $this->banner($workspaceId, $task, $now, $settings),
            'history' => iterator_to_array($this->tasks()->find(
                ['workspaceId' => $workspaceId, 'subjectId' => $crewId, 'type' => self::Type, 'missionDay' => ['$lt' => $today]],
                ['sort' => ['missionDay' => -1], 'limit' => 14, 'typeMap' => self::TypeMap],
            ), false),
        ];
    }

    /**
     * "Snooze 30 min": new due time = action time + 30 min, only if it stays
     * within the current mission day.
     *
     * @return array<string, mixed>
     */
    public function snooze(string $workspaceId, string $crewId, int $missionDay): array
    {
        $plan = $this->plan($workspaceId, $crewId);
        $now = $this->clock->now($workspaceId);
        $task = $plan['today'];

        if ($task['missionDay'] !== $missionDay || ! in_array($task['state'], ['due', 'snoozed'], true)) {
            throw new ReminderActionException('Only today\'s open reminder can be snoozed.');
        }

        $until = $now->addMinutes((int) config('hexta.reminder.snooze_minutes'));

        if ($until->greaterThanOrEqualTo($this->clock->dayStart($workspaceId, $missionDay + 1))) {
            throw new ReminderActionException('Snoozing would move the reminder to the next mission day.');
        }

        $this->tasks()->updateOne(['key' => $task['key']], ['$set' => [
            'snoozedUntil' => new UTCDateTime($until),
            'bannerDismissedFor' => null,
        ]]);

        return $this->plan($workspaceId, $crewId);
    }

    /**
     * "Dismiss banner": hides the banner for the current due time only.
     *
     * @return array<string, mixed>
     */
    public function dismissBanner(string $workspaceId, string $crewId, int $missionDay): array
    {
        $task = $this->plan($workspaceId, $crewId)['today'];

        if ($task['missionDay'] !== $missionDay || $task['state'] !== 'due') {
            throw new ReminderActionException('The banner can only be dismissed while the reminder is due.');
        }

        $this->tasks()->updateOne(['key' => $task['key']], ['$set' => ['bannerDismissedFor' => $task['effectiveDueAt']]]);

        return $this->plan($workspaceId, $crewId);
    }

    /**
     * Changing the time recomputes the due time and clears snooze and
     * dismissal. Disabling removes the banner and the active bell entry.
     *
     * @return array<string, mixed>
     */
    public function updateSettings(string $workspaceId, string $crewId, bool $enabled, string $time): array
    {
        $this->members()->updateOne(
            ['workspaceId' => $workspaceId, 'crewId' => $crewId],
            ['$set' => ['reminder' => ['enabled' => $enabled, 'time' => $time]]],
        );

        $today = $this->clock->missionDay($workspaceId);

        $this->tasks()->updateOne(
            ['key' => $this->key($workspaceId, $crewId, $today), 'state' => ['$ne' => 'completed']],
            ['$set' => [
                'scheduledTime' => $time,
                'dueAt' => new UTCDateTime($this->dueAt($workspaceId, $today, $time)),
                'snoozedUntil' => null,
                'bannerDismissedFor' => null,
            ]],
        );

        if (! $enabled) {
            $this->notifications->deactivate($workspaceId, $this->eventKey($crewId, $today));
        }

        return $this->plan($workspaceId, $crewId);
    }

    /**
     * Called after a check-in is saved: closes the reminder of that day.
     */
    public function complete(string $workspaceId, string $crewId, int $missionDay): void
    {
        $this->tasks()->updateOne(
            ['key' => $this->key($workspaceId, $crewId, $missionDay)],
            ['$set' => ['state' => 'completed', 'snoozedUntil' => null, 'completedAt' => new UTCDateTime($this->clock->now($workspaceId))]],
        );

        $this->notifications->close($workspaceId, $this->eventKey($crewId, $missionDay));
    }

    /**
     * @param  array{enabled: bool, time: string}  $settings
     * @return array<string, mixed>
     */
    private function refreshDay(string $workspaceId, string $crewId, int $day, CarbonImmutable $now, array $settings): array
    {
        $key = $this->key($workspaceId, $crewId, $day);

        $this->tasks()->updateOne(['key' => $key], ['$setOnInsert' => [
            'workspaceId' => $workspaceId,
            'missionId' => $this->clock->missionId($workspaceId),
            'subjectId' => $crewId,
            'missionDay' => $day,
            'type' => self::Type,
            'scheduledTime' => $settings['time'],
            'dueAt' => new UTCDateTime($this->dueAt($workspaceId, $day, $settings['time'])),
            'snoozedUntil' => null,
            'bannerDismissedFor' => null,
            'notifiedFor' => null,
            'state' => 'scheduled',
            'createdAt' => new UTCDateTime($now),
        ]], ['upsert' => true]);

        $task = $this->tasks()->findOne(['key' => $key], ['typeMap' => self::TypeMap]);
        $dueAt = CarbonImmutable::instance($task['dueAt']->toDateTime());
        $snoozedUntil = $task['snoozedUntil'] ? CarbonImmutable::instance($task['snoozedUntil']->toDateTime()) : null;
        $effectiveDue = $snoozedUntil ?? $dueAt;

        $state = match (true) {
            $this->hasSubmittedCheckin($workspaceId, $crewId, $day) => 'completed',
            $snoozedUntil !== null && $now->lessThan($snoozedUntil) => 'snoozed',
            $now->greaterThanOrEqualTo($dueAt) => 'due',
            default => 'scheduled',
        };

        $set = ['state' => $state, 'effectiveDueAt' => $effectiveDue->format('Y-m-d\TH:i:s\Z')];

        if ($state === 'completed' && $task['state'] !== 'completed') {
            $set['snoozedUntil'] = null;
            $set['completedAt'] = new UTCDateTime($now);
            $this->notifications->close($workspaceId, $this->eventKey($crewId, $day));
        }

        if ($state === 'due' && $settings['enabled']) {
            $comesDueAgain = $task['notifiedFor'] !== $set['effectiveDueAt'];
            $this->notifications->upsert($workspaceId, $this->eventKey($crewId, $day), $crewId, [
                'type' => 'checkin_due',
                'title' => 'Daily check-in is due',
                'body' => sprintf('Day %d check-in, due %s UTC.', $day, $effectiveDue->format('H:i')),
                'target' => ['type' => 'checkin', 'missionDay' => $day],
            ], new UTCDateTime($effectiveDue), markUnread: $comesDueAgain);
            $set['notifiedFor'] = $set['effectiveDueAt'];
        }

        if (! $settings['enabled']) {
            $this->notifications->deactivate($workspaceId, $this->eventKey($crewId, $day));
        }

        $this->tasks()->updateOne(['key' => $key], ['$set' => $set]);

        return $this->tasks()->findOne(['key' => $key], ['typeMap' => self::TypeMap]);
    }

    /**
     * @param  array<string, mixed>  $task
     * @param  array{enabled: bool, time: string}  $settings
     * @return array{visible: bool, label: ?string, dueAt: ?string, snoozedUntil: ?string, canSnooze: bool, remindersEnabled: bool}
     */
    private function banner(string $workspaceId, array $task, CarbonImmutable $now, array $settings): array
    {
        $visible = $settings['enabled'] && $task['state'] === 'due' && $task['bannerDismissedFor'] !== $task['effectiveDueAt'];
        $snoozeLimit = $this->clock->dayStart($workspaceId, $task['missionDay'] + 1);

        return [
            'visible' => $visible,
            'label' => match ($task['state']) {
                'due' => 'Daily check-in is due',
                'snoozed' => 'Snoozed until '.CarbonImmutable::instance($task['snoozedUntil']->toDateTime())->format('H:i'),
                'completed' => 'Saved on this device',
                default => 'Scheduled '.$task['scheduledTime'],
            },
            'dueAt' => $task['effectiveDueAt'],
            'snoozedUntil' => $task['snoozedUntil'] ? CarbonImmutable::instance($task['snoozedUntil']->toDateTime())->format('Y-m-d\TH:i:s\Z') : null,
            'canSnooze' => in_array($task['state'], ['due', 'snoozed'], true)
                && $now->addMinutes((int) config('hexta.reminder.snooze_minutes'))->lessThan($snoozeLimit),
            'remindersEnabled' => $settings['enabled'],
        ];
    }

    private function markPreviousDaysMissed(string $workspaceId, string $crewId, int $today): void
    {
        $open = $this->tasks()->find(
            ['workspaceId' => $workspaceId, 'subjectId' => $crewId, 'type' => self::Type, 'missionDay' => ['$lt' => $today], 'state' => ['$nin' => ['completed', 'missed']]],
            ['typeMap' => self::TypeMap],
        );

        foreach ($open as $task) {
            $state = $this->hasSubmittedCheckin($workspaceId, $crewId, $task['missionDay']) ? 'completed' : 'missed';
            $this->tasks()->updateOne(['_id' => $task['_id']], ['$set' => ['state' => $state, 'snoozedUntil' => null]]);
            $this->notifications->close($workspaceId, $this->eventKey($crewId, $task['missionDay']), $state === 'missed' ? 'missed' : 'done');
        }
    }

    private function hasSubmittedCheckin(string $workspaceId, string $crewId, int $day): bool
    {
        return DB::connection('mongodb')->getCollection('checkins')->countDocuments(
            ['workspaceId' => $workspaceId, 'subjectId' => $crewId, 'missionDay' => $day, 'status' => 'submitted'],
            ['limit' => 1],
        ) > 0;
    }

    /**
     * @return array{enabled: bool, time: string}
     */
    private function settings(string $workspaceId, string $crewId): array
    {
        $member = $this->members()->findOne(['workspaceId' => $workspaceId, 'crewId' => $crewId], ['typeMap' => self::TypeMap]);

        return [
            'enabled' => (bool) ($member['reminder']['enabled'] ?? true),
            'time' => (string) ($member['reminder']['time'] ?? config('hexta.reminder.default_time')),
        ];
    }

    private function dueAt(string $workspaceId, int $day, string $time): CarbonImmutable
    {
        return $this->clock->dayStart($workspaceId, $day)->setTimeFromTimeString($time);
    }

    public function key(string $workspaceId, string $crewId, int $day): string
    {
        return implode('|', [$workspaceId, $this->clock->missionId($workspaceId), $crewId, $day, self::Type]);
    }

    private function eventKey(string $crewId, int $day): string
    {
        return "checkin_due:{$crewId}:J{$day}";
    }

    private function tasks(): Collection
    {
        return DB::connection('mongodb')->getCollection('tasks');
    }

    private function members(): Collection
    {
        return DB::connection('mongodb')->getCollection('crew_members');
    }
}
