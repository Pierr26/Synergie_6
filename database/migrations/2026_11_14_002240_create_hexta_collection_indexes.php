<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;
use MongoDB\Laravel\Schema\Blueprint;

/**
 * MongoDB indexes for HEXTA.
 *
 * Every board-side collection is keyed by workspaceId first so that the
 * Explore app and Start demo data never cross (M13). Unique indexes enforce
 * the idempotency keys required by the cahier des charges.
 */
return new class extends Migration
{
    protected $connection = 'mongodb';

    /**
     * @var array<string, list<array{0: list<string>|array<string, int>, 1: string, 2?: array<string, mixed>}>>
     */
    private array $indexes = [
        'crew_members' => [
            [['workspaceId' => 1, 'crewId' => 1], 'crew_unique', ['unique' => true]],
        ],
        'observations' => [
            [['workspaceId' => 1, 'subjectId' => 1, 'variable' => 1, 'missionDay' => 1], 'obs_series'],
            [['workspaceId' => 1, 'lineageId' => 1, 'version' => 1], 'obs_version_unique', ['unique' => true]],
            [['workspaceId' => 1, 'subjectId' => 1, 'observedAt' => -1], 'obs_recent'],
        ],
        'checkins' => [
            [['workspaceId' => 1, 'missionId' => 1, 'subjectId' => 1, 'missionDay' => 1], 'checkin_day_unique', ['unique' => true]],
        ],
        'tasks' => [
            [['key' => 1], 'task_key_unique', ['unique' => true]],
            [['workspaceId' => 1, 'subjectId' => 1, 'missionDay' => 1], 'task_by_day'],
        ],
        'notifications' => [
            [['workspaceId' => 1, 'eventKey' => 1, 'recipientId' => 1], 'notification_event_unique', ['unique' => true]],
            [['workspaceId' => 1, 'recipientId' => 1, 'readAt' => 1, 'createdAt' => -1], 'notification_inbox'],
        ],
        'follow_ups' => [
            [['workspaceId' => 1, 'targetId' => 1, 'status' => 1], 'follow_up_target'],
            [['workspaceId' => 1, 'authorId' => 1, 'createdAt' => -1], 'follow_up_author'],
        ],
        'alerts' => [
            [['episodeKey' => 1], 'alert_episode_unique', ['unique' => true]],
            [['workspaceId' => 1, 'subjectId' => 1, 'status' => 1], 'alert_by_subject'],
        ],
        'lab_results' => [
            [['workspaceId' => 1, 'subjectId' => 1, 'analyte' => 1, 'collectedAt' => -1], 'lab_series'],
            [['workspaceId' => 1, 'lineageId' => 1, 'version' => 1], 'lab_version_unique', ['unique' => true]],
        ],
        'report_snapshots' => [
            [['workspaceId' => 1, 'subjectId' => 1, 'generatedAt' => -1], 'snapshot_by_subject'],
        ],
        'reports' => [
            [['workspaceId' => 1, 'subjectCrewId' => 1, 'receivedAt' => -1], 'ground_by_subject'],
        ],
        'osdr_measurements' => [
            [['subjectId' => 1, 'indicator' => 1, 'timepoint' => 1, 'study' => 1], 'osdr_unique', ['unique' => true]],
            [['indicator' => 1, 'phase' => 1], 'osdr_indicator_phase'],
        ],
    ];

    public function up(): void
    {
        foreach ($this->indexes as $collection => $definitions) {
            Schema::connection('mongodb')->table($collection, function (Blueprint $blueprint) use ($definitions): void {
                foreach ($definitions as $definition) {
                    $blueprint->index($definition[0], $definition[1], null, $definition[2] ?? []);
                }
            });
        }
    }

    public function down(): void
    {
        foreach ($this->indexes as $collection => $definitions) {
            Schema::connection('mongodb')->table($collection, function (Blueprint $blueprint) use ($definitions): void {
                foreach ($definitions as $definition) {
                    $blueprint->dropIndex($definition[1]);
                }
            });
        }
    }
};
