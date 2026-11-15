<?php

namespace App\Services\Exports;

use App\Services\Lab\LabResultService;
use App\Services\Workspace\WorkspaceClock;
use App\Support\MongoJson;
use Illuminate\Support\Facades\DB;

/**
 * CSV / JSON export of one crew member's records (SHOULD, p.3 and p.15).
 *
 * Every row keeps its value, original unit, method, quality and source so
 * the fictional crew series and NASA records stay identifiable. The
 * "matlab-sleep" format is the CSV the MATLAB cross-check expects (p.20).
 */
final class CrewExporter
{
    private const array TypeMap = ['root' => 'array', 'document' => 'array', 'array' => 'array'];

    /** @var list<string> */
    public const array CsvColumns = [
        'record_type', 'id', 'variable', 'mission_day', 'observed_at', 'value', 'value_2', 'unit', 'method',
        'device', 'quality', 'quality_flags', 'series_key', 'source', 'version', 'author',
    ];

    public function __construct(
        private readonly WorkspaceClock $clock,
        private readonly LabResultService $labs,
    ) {}

    /**
     * @return array<string, mixed>
     */
    public function json(string $workspaceId, string $crewId, ?int $fromDay, ?int $toDay): array
    {
        $workspace = $this->clock->workspace($workspaceId);

        return MongoJson::normalize([
            'exportedAt' => now('UTC')->format('Y-m-d\TH:i:s\Z'),
            'workspaceId' => $workspaceId,
            'missionId' => $workspace['missionId'],
            'subjectId' => $crewId,
            'dataLabel' => $workspace['dataLabel'] ?? null,
            'period' => ['fromDay' => $fromDay, 'toDay' => $toDay],
            'observations' => $this->observations($workspaceId, $crewId, $fromDay, $toDay),
            'labResults' => $this->labs->list($workspaceId, $crewId),
        ]);
    }

    /**
     * @return list<list<string|int|float|null>>
     */
    public function csvRows(string $workspaceId, string $crewId, ?int $fromDay, ?int $toDay): array
    {
        $rows = [self::CsvColumns];

        foreach ($this->observations($workspaceId, $crewId, $fromDay, $toDay) as $observation) {
            $value = $observation['value'];
            $isPair = is_array($value);

            $rows[] = [
                'observation',
                $observation['_id'],
                $observation['variable'],
                $observation['missionDay'],
                MongoJson::normalize($observation['observedAt']),
                $isPair ? ($value['systolic'] ?? null) : $value,
                $isPair ? ($value['diastolic'] ?? null) : null,
                $observation['unit'] ?? null,
                $observation['method'],
                $observation['device'] ?? null,
                $observation['quality'],
                implode(';', $observation['qualityFlags'] ?? []),
                $observation['seriesKey'] ?? null,
                $observation['source'] ?? null,
                $observation['version'],
                $observation['author']['crewId'] ?? null,
            ];
        }

        foreach ($this->labs->list($workspaceId, $crewId) as $result) {
            $rows[] = [
                'lab_result',
                $result['_id'],
                $result['analyte'],
                null,
                MongoJson::normalize($result['collectedAt'] ?? null),
                $result['value'],
                null,
                $result['unit'] ?? null,
                $result['method'] ?? null,
                $result['laboratory'] ?? null,
                $result['evaluation']['status'],
                implode(';', $result['reviewFlags']),
                null,
                $result['source'] ?? null,
                $result['version'],
                $result['enteredBy']['crewId'] ?? null,
            ];
        }

        return $rows;
    }

    /**
     * case_id, mission_day, sleep_minutes, method, quality, is_baseline (p.20).
     *
     * @return list<list<string|int|float|null>>
     */
    public function matlabSleepRows(string $workspaceId, string $crewId): array
    {
        $window = $this->clock->workspace($workspaceId)['policy']['baselineWindow'] ?? null;
        $rows = [['case_id', 'mission_day', 'sleep_minutes', 'method', 'quality', 'is_baseline']];

        foreach ($this->observations($workspaceId, $crewId, null, null, 'sleep_duration') as $observation) {
            $day = (int) $observation['missionDay'];
            $rows[] = [
                "{$workspaceId}-{$crewId}",
                $day,
                $observation['value'],
                $observation['method'],
                $observation['quality'],
                $window !== null && $day >= $window['fromDay'] && $day <= $window['toDay'] ? 1 : 0,
            ];
        }

        return $rows;
    }

    /**
     * @param  list<list<string|int|float|null>>  $rows
     */
    public static function toCsv(array $rows): string
    {
        $stream = fopen('php://temp', 'w+');

        foreach ($rows as $row) {
            fputcsv($stream, array_map(fn ($cell): string => match (true) {
                $cell === null => '',
                is_bool($cell) => $cell ? '1' : '0',
                default => (string) $cell,
            }, $row), escape: '');
        }

        rewind($stream);
        $csv = (string) stream_get_contents($stream);
        fclose($stream);

        return $csv;
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function observations(string $workspaceId, string $crewId, ?int $fromDay, ?int $toDay, ?string $variable = null): array
    {
        $query = array_filter([
            'workspaceId' => $workspaceId,
            'subjectId' => $crewId,
            'status' => 'current',
            'variable' => $variable,
        ]);

        if ($fromDay !== null || $toDay !== null) {
            $query['missionDay'] = array_filter(['$gte' => $fromDay, '$lte' => $toDay], fn (?int $day): bool => $day !== null);
        }

        return iterator_to_array(DB::connection('mongodb')->getCollection('observations')->find(
            $query,
            ['sort' => ['missionDay' => 1, 'variable' => 1, '_id' => 1], 'typeMap' => self::TypeMap],
        ), false);
    }
}
