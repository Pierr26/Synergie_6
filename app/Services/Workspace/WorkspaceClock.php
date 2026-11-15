<?php

namespace App\Services\Workspace;

use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;
use RuntimeException;

/**
 * Mission clock of a workspace (cahier des charges p.2, p.5, p.18).
 *
 * Explore app follows real UTC time. Start demo uses a controlled clock
 * stored in the workspace document ("Advance 1 minute"). Mission days start
 * at 00:00 UTC from the mission epoch (J0).
 */
final class WorkspaceClock
{
    private const array TypeMap = ['root' => 'array', 'document' => 'array', 'array' => 'array'];

    /**
     * @return array<string, mixed>
     */
    public function workspace(string $workspaceId): array
    {
        $workspace = $this->collection()->findOne(['_id' => $workspaceId], ['typeMap' => self::TypeMap]);

        if ($workspace === null) {
            throw new RuntimeException("Workspace {$workspaceId} is not installed. Run php artisan db:seed.");
        }

        return $workspace;
    }

    public function now(string $workspaceId): CarbonImmutable
    {
        $workspace = $this->workspace($workspaceId);

        return $this->isControlled($workspace)
            ? CarbonImmutable::instance($workspace['clock']['current']->toDateTime())->utc()
            : CarbonImmutable::now('UTC');
    }

    public function epoch(string $workspaceId): CarbonImmutable
    {
        return CarbonImmutable::instance($this->workspace($workspaceId)['missionEpoch']->toDateTime())->utc();
    }

    public function missionDay(string $workspaceId, ?CarbonImmutable $at = null): int
    {
        $at ??= $this->now($workspaceId);

        return (int) floor($this->epoch($workspaceId)->diffInSeconds($at) / 86400);
    }

    public function dayStart(string $workspaceId, int $missionDay): CarbonImmutable
    {
        return $this->epoch($workspaceId)->addDays($missionDay);
    }

    public function missionId(string $workspaceId): string
    {
        return (string) $this->workspace($workspaceId)['missionId'];
    }

    /**
     * Moves the controlled clock forward (Start demo only).
     */
    public function advance(string $workspaceId, int $minutes): CarbonImmutable
    {
        return $this->set($workspaceId, $this->now($workspaceId)->addMinutes($minutes));
    }

    public function set(string $workspaceId, CarbonImmutable $at): CarbonImmutable
    {
        if (! $this->isControlled($this->workspace($workspaceId))) {
            throw new ControlledClockException('Only the Start demo workspace has a controlled clock.');
        }

        $this->collection()->updateOne(['_id' => $workspaceId], ['$set' => ['clock.current' => new UTCDateTime($at)]]);

        return $at->utc();
    }

    /**
     * @return array{workspaceId: string, type: string, now: string, missionDay: int, missionId: string, timezone: string, dayBoundaryUtc: string}
     */
    public function describe(string $workspaceId): array
    {
        $workspace = $this->workspace($workspaceId);
        $now = $this->now($workspaceId);

        return [
            'workspaceId' => $workspaceId,
            'type' => $workspace['clock']['type'],
            'now' => $now->format('Y-m-d\TH:i:s\Z'),
            'missionDay' => $this->missionDay($workspaceId, $now),
            'missionId' => $workspace['missionId'],
            'timezone' => 'UTC',
            'dayBoundaryUtc' => $workspace['dayBoundaryUtc'] ?? '00:00',
        ];
    }

    /**
     * @param  array<string, mixed>  $workspace
     */
    private function isControlled(array $workspace): bool
    {
        return ($workspace['clock']['type'] ?? 'real') === 'controlled';
    }

    private function collection(): Collection
    {
        return DB::connection('mongodb')->getCollection('workspaces');
    }
}
