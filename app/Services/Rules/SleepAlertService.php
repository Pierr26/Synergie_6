<?php

namespace App\Services\Rules;

use App\Services\Notifications\NotificationCenter;
use App\Services\Workspace\WorkspaceClock;
use Illuminate\Support\Facades\DB;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;

/**
 * Persists SLEEP-001 episodes for workspaces whose policy enables the rule
 * (Start demo only). One alert and one CMO notification per episode; a
 * fourth short night extends the evidence; an alert whose condition no
 * longer holds after a correction is kept with status "no_longer_met".
 */
final class SleepAlertService
{
    private const array TypeMap = ['root' => 'array', 'document' => 'array', 'array' => 'array'];

    /** Alert statuses that still describe an ongoing episode. */
    public const array OpenStatuses = ['needs_review', 'reviewed'];

    public function __construct(
        private readonly SleepRule $rule,
        private readonly WorkspaceClock $clock,
        private readonly NotificationCenter $notifications,
    ) {}

    /**
     * @return list<array<string, mixed>> alerts currently open for the crew member
     */
    public function evaluate(string $workspaceId, string $crewId): array
    {
        $workspace = $this->clock->workspace($workspaceId);
        $policy = $workspace['policy']['sleepRule'] ?? null;

        if ($policy === null || $policy['id'] !== $this->rule->ruleId) {
            return [];
        }

        $now = new UTCDateTime($this->clock->now($workspaceId));
        $missionId = $workspace['missionId'];
        $episodes = $this->rule->episodes($this->sleepSeries($workspaceId, $crewId), $this->clock->missionDay($workspaceId));
        $activeKeys = [];

        foreach ($episodes as $episode) {
            $episodeKey = implode('|', [$workspaceId, $missionId, $crewId, $episode['ruleId'], $episode['startDay']]);
            $activeKeys[] = $episodeKey;

            $result = $this->alerts()->updateOne(['episodeKey' => $episodeKey], [
                '$setOnInsert' => [
                    '_id' => "alert-{$workspaceId}-{$crewId}-{$episode['ruleId']}-J{$episode['startDay']}",
                    'workspaceId' => $workspaceId,
                    'missionId' => $missionId,
                    'subjectId' => $crewId,
                    'rule' => $episode['ruleId'],
                    'ruleVersion' => $episode['ruleVersion'],
                    'label' => $policy['label'] ?? 'Demo rule',
                    'startDay' => $episode['startDay'],
                    'triggeredOnDay' => $episode['triggeredOnDay'],
                    'createdAt' => $now,
                    'reviews' => [],
                    'status' => 'needs_review',
                ],
                '$set' => [
                    'lastDay' => $episode['lastDay'],
                    'evidence' => $episode['evidence'],
                    'evaluatedAt' => $now,
                ],
            ], ['upsert' => true]);

            if ($result->getUpsertedCount() > 0) {
                $this->notifyCmos($workspaceId, $crewId, $episodeKey, $episode, $now);
            }
        }

        $this->alerts()->updateMany(
            ['workspaceId' => $workspaceId, 'subjectId' => $crewId, 'status' => ['$in' => self::OpenStatuses], 'episodeKey' => ['$nin' => $activeKeys]],
            ['$set' => ['status' => 'no_longer_met', 'evaluatedAt' => $now]],
        );

        return iterator_to_array($this->alerts()->find(
            ['workspaceId' => $workspaceId, 'subjectId' => $crewId, 'status' => ['$in' => self::OpenStatuses]],
            ['sort' => ['startDay' => 1], 'typeMap' => self::TypeMap],
        ), false);
    }

    /**
     * CMO review of an episode. The history is kept; later nights of the
     * same episode do not erase it.
     *
     * @param  array{cmoId: string, note: string, decision: string}  $review
     * @return array<string, mixed>
     */
    public function review(string $workspaceId, string $alertId, array $review): array
    {
        $now = new UTCDateTime($this->clock->now($workspaceId));
        $result = $this->alerts()->updateOne(
            ['_id' => $alertId, 'workspaceId' => $workspaceId],
            [
                '$push' => ['reviews' => [...$review, 'reviewedAt' => $now]],
                '$set' => ['status' => 'reviewed'],
            ],
        );

        abort_if($result->getMatchedCount() === 0, 404, 'Alert not found in this workspace.');

        $alert = $this->alerts()->findOne(['_id' => $alertId], ['typeMap' => self::TypeMap]);
        $this->notifications->close($workspaceId, "sleep_alert:{$alert['episodeKey']}", 'reviewed');

        return $alert;
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function forSubject(string $workspaceId, string $crewId): array
    {
        return iterator_to_array($this->alerts()->find(
            ['workspaceId' => $workspaceId, 'subjectId' => $crewId],
            ['sort' => ['startDay' => -1], 'typeMap' => self::TypeMap],
        ), false);
    }

    /**
     * @param  array{startDay: int, evidence: list<array{missionDay: int, minutes: int|float, observationId: string}>}  $episode
     */
    private function notifyCmos(string $workspaceId, string $crewId, string $episodeKey, array $episode, UTCDateTime $now): void
    {
        $members = DB::connection('mongodb')->getCollection('crew_members');
        $alias = $members->findOne(['workspaceId' => $workspaceId, 'crewId' => $crewId])['alias'] ?? $crewId;
        $minutes = implode(', ', array_map(fn (array $night): string => "J{$night['missionDay']} {$night['minutes']} min", $episode['evidence']));

        foreach ($members->find(['workspaceId' => $workspaceId, 'role' => 'cmo']) as $cmo) {
            $this->notifications->upsert($workspaceId, "sleep_alert:{$episodeKey}", $cmo['crewId'], [
                'type' => 'sleep_trend_review',
                'title' => 'Sleep trend needs review',
                'body' => "{$alias}: three consecutive diary nights under 360 min ({$minutes}). Demo rule SLEEP-001 v1.",
                'target' => ['type' => 'alert', 'episodeKey' => $episodeKey, 'subjectId' => $crewId],
                'priority' => 'cmo_review',
            ], $now);
        }
    }

    /**
     * @return list<array{missionDay: int, minutes: mixed, method: string, quality: string, observationId: string, version: int}>
     */
    private function sleepSeries(string $workspaceId, string $crewId): array
    {
        $cursor = DB::connection('mongodb')->getCollection('observations')->find(
            ['workspaceId' => $workspaceId, 'subjectId' => $crewId, 'variable' => 'sleep_duration', 'status' => 'current'],
            ['sort' => ['missionDay' => 1], 'typeMap' => self::TypeMap],
        );

        $series = [];

        foreach ($cursor as $observation) {
            $series[] = [
                'missionDay' => (int) $observation['missionDay'],
                'minutes' => $observation['value'],
                'method' => $observation['method'],
                'quality' => $observation['quality'],
                'observationId' => $observation['_id'],
                'version' => (int) $observation['version'],
            ];
        }

        return $series;
    }

    private function alerts(): Collection
    {
        return DB::connection('mongodb')->getCollection('alerts');
    }
}
