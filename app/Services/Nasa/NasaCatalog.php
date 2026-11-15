<?php

namespace App\Services\Nasa;

use Illuminate\Support\Facades\DB;
use MongoDB\Collection;

/**
 * Read-only NASA reference data for Trends and Body & Risks (M07, p.16).
 *
 * Real astronaut measurements come from NASA OSDR (Inspiration4, CC0-1.0):
 * a 3-day low-orbit mission, used as historical context and never mixed
 * with the fictional crew series. Every answer carries its source,
 * licence and caveat.
 */
final class NasaCatalog
{
    private const array TypeMap = ['root' => 'array', 'document' => 'array', 'array' => 'array'];

    /**
     * @return list<array<string, mixed>>
     */
    public function hazards(): array
    {
        return iterator_to_array($this->collection('hazards')->find([], ['sort' => ['_id' => 1], 'typeMap' => self::TypeMap]), false);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function hazard(string $hazardId): ?array
    {
        $hazard = $this->collection('hazards')->findOne(['_id' => $hazardId], ['typeMap' => self::TypeMap]);

        if ($hazard === null) {
            return null;
        }

        $indicatorIds = array_values(array_unique(array_merge(...array_map(fn (array $risk): array => $risk['indicators'] ?? [], $hazard['risks'] ?? []))));
        $hazard['indicatorCards'] = iterator_to_array($this->collection('health_indicators')->find(['_id' => ['$in' => $indicatorIds]], ['sort' => ['_id' => 1], 'typeMap' => self::TypeMap]), false);

        return $hazard;
    }

    /**
     * Indicator cards: how to measure, instrument, linked hazards, reference source.
     *
     * @return list<array<string, mixed>>
     */
    public function indicatorCards(): array
    {
        return iterator_to_array($this->collection('health_indicators')->find([], ['sort' => ['_id' => 1], 'typeMap' => self::TypeMap]), false);
    }

    /**
     * @return array<string, mixed>|null
     */
    public function indicatorCard(string $indicatorId): ?array
    {
        $card = $this->collection('health_indicators')->findOne(['_id' => $indicatorId], ['typeMap' => self::TypeMap]);

        if ($card === null) {
            return null;
        }

        $card['adviceCards'] = iterator_to_array($this->collection('advice_cards')->find(['indicator' => $indicatorId], ['sort' => ['_id' => 1], 'typeMap' => self::TypeMap]), false);

        return $card;
    }

    /**
     * OSDR analytes available as series, with unit and terrestrial reference range.
     *
     * @return list<array<string, mixed>>
     */
    public function osdrIndicators(?string $category = null): array
    {
        return iterator_to_array($this->collection('indicator_reference')->find(
            array_filter(['category' => $category]),
            ['sort' => ['category' => 1, '_id' => 1], 'typeMap' => self::TypeMap],
        ), false);
    }

    /**
     * One series per astronaut, ordered L-92 ... L-3, R+1 ... R+194.
     *
     * @return array{indicator: string, unit: ?string, reference: array{min: mixed, max: mixed, source: string}, phases: array<string, string>, source: array<string, mixed>, series: list<array<string, mixed>>}|null
     */
    public function osdrSeries(string $indicator, ?string $subjectId = null): ?array
    {
        $cursor = $this->collection('osdr_measurements')->find(
            array_filter(['indicator' => $indicator, 'subjectId' => $subjectId]),
            ['sort' => ['subjectId' => 1, 'anchor' => 1, 'relativeDay' => 1], 'typeMap' => self::TypeMap],
        );

        $series = [];
        $first = null;

        foreach ($cursor as $measurement) {
            $first ??= $measurement;
            $series[$measurement['subjectId']]['subjectId'] = $measurement['subjectId'];
            $series[$measurement['subjectId']]['sex'] = $measurement['sex'] ?? null;
            $series[$measurement['subjectId']]['points'][] = [
                'timepoint' => $measurement['timepoint'],
                'phase' => $measurement['phase'],
                'anchor' => $measurement['anchor'],
                'relativeDay' => $measurement['relativeDay'],
                'value' => $measurement['value'],
                'quality' => $measurement['quality'],
                'refMin' => $measurement['refMin'] ?? null,
                'refMax' => $measurement['refMax'] ?? null,
            ];
        }

        if ($first === null) {
            return null;
        }

        return [
            'indicator' => $indicator,
            'unit' => $first['unit'] ?? null,
            'reference' => ['min' => $first['refMin'] ?? null, 'max' => $first['refMax'] ?? null, 'source' => 'Terrestrial reference range reported with the OSDR file (Quest Diagnostics)'],
            'phases' => ['preflight' => 'L-n: days before launch', 'postflight' => 'R+n: days after return'],
            'source' => [
                'organisation' => 'NASA Open Science Data Repository',
                'study' => $first['study'],
                'mission' => $first['mission'],
                'doi' => $first['doi'] ?? null,
                'licence' => $first['license'] ?? 'CC0-1.0',
                'caveat' => $first['caveat'] ?? null,
                'methodLabel' => 'NASA OSDR instrumented record',
            ],
            'series' => array_values($series),
        ];
    }

    /**
     * Dataset provenance: file, SHA-256, size, licence, import time.
     *
     * @return list<array<string, mixed>>
     */
    public function datasets(): array
    {
        return iterator_to_array($this->collection('datasets')->find([], ['sort' => ['_id' => 1], 'projection' => ['meta.files' => 0], 'typeMap' => self::TypeMap]), false);
    }

    private function collection(string $name): Collection
    {
        return DB::connection('mongodb')->getCollection($name);
    }
}
