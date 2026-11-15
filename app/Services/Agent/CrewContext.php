<?php

namespace App\Services\Agent;

use Illuminate\Support\Facades\DB;

/**
 * Read-only view of a crew member's recent observations, scoped to one
 * workspace. Exposed to the agent as the `get_recent_observations` tool.
 */
final class CrewContext
{
    /** @var list<string> */
    public const array Variables = [
        'sleep_duration', 'actigraphy_sleep_duration', 'sleepiness', 'mood', 'fatigue', 'stress', 'perceived_isolation', 'perceived_workload', 'resting_heart_rate', 'heart_rate', 'blood_pressure',
        'spo2', 'temperature', 'glucose', 'urine_color', 'skin_observation', 'fluid_intake',
    ];

    /**
     * @param  list<string>  $variables
     * @return list<array{variable: string, missionDay: ?int, value: mixed, unit: ?string, method: ?string, quality: ?string, context: array<string, mixed>, observedAt: ?string}>
     */
    public function recentObservations(string $workspaceId, string $subjectId, array $variables, int $limit = 20): array
    {
        $variables = array_values(array_intersect($variables, self::Variables));

        if ($variables === []) {
            return [];
        }

        $cursor = DB::connection('mongodb')->getCollection('observations')->find(
            ['workspaceId' => $workspaceId, 'subjectId' => $subjectId, 'variable' => ['$in' => $variables], 'status' => 'current'],
            [
                'sort' => ['observedAt' => -1, '_id' => 1],
                'limit' => max(1, min($limit, 40)),
                'typeMap' => ['root' => 'array', 'document' => 'array', 'array' => 'array'],
            ],
        );

        $observations = [];

        foreach ($cursor as $observation) {
            $observations[] = [
                'variable' => $observation['variable'],
                'missionDay' => $observation['missionDay'] ?? null,
                'value' => $observation['value'] ?? null,
                'unit' => $observation['unit'] ?? null,
                'method' => $observation['method'] ?? null,
                'quality' => $observation['quality'] ?? null,
                'context' => $observation['context'] ?? [],
                'observedAt' => isset($observation['observedAt']) ? $observation['observedAt']->toDateTime()->format(DATE_ATOM) : null,
            ];
        }

        return $observations;
    }
}
