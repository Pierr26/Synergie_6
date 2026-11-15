<?php

namespace App\Console\Commands;

use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;

/**
 * Loads the "Banque Données Health Monitoring" into MongoDB.
 *
 * Idempotent: every document is upserted on a stable key, so the command can
 * be replayed against a local replica set or Atlas without duplicates.
 * Each source file is fingerprinted (SHA-256) in the `datasets` collection
 * to keep the traceability required by the cahier des charges (p.16).
 */
#[Signature('hexta:import-nasa-data {--path= : Directory holding the seed JSON files} {--knowledge-only : Import the knowledge base and references, skip the 7 768 OSDR measurements}')]
#[Description('Import NASA OSDR measurements and HEXTA reference data into MongoDB')]
class ImportNasaData extends Command
{
    private const string Licence = 'CC0-1.0';

    public function handle(): int
    {
        $directory = $this->option('path') ?: database_path('data/nasa');
        $osdrFile = "{$directory}/osdr_seed.json";
        $knowledgeFile = "{$directory}/knowledge_seed.json";
        $visionFile = database_path('data/knowledge/vision_knowledge.json');
        $englishFile = database_path('data/knowledge/reference_en.json');
        $manifestFile = "{$directory}/osdr_manifest.json";

        foreach ([$osdrFile, $knowledgeFile, $manifestFile, $visionFile, $englishFile] as $file) {
            if (! is_file($file)) {
                $this->components->error("Missing seed file: {$file}");

                return self::FAILURE;
            }
        }

        $osdr = $this->readJson($osdrFile);
        $knowledge = $this->readJson($knowledgeFile);
        $manifest = $this->readJson($manifestFile);
        $vision = $this->readJson($visionFile);
        $english = $this->readJson($englishFile);

        if (! $this->option('knowledge-only')) {
            $this->components->task('OSDR measurements', fn () => $this->importMeasurements($osdr['measurements'], $osdr['_meta']));
        }
        $this->components->task('Indicator reference (OSDR)', fn () => $this->upsertById('indicator_reference', array_map(fn (array $row): array => $this->translate($row, [
            'label' => $english['osdrLabels'][$row['indicator']] ?? $row['label'],
            'category' => $english['osdrCategories'][$row['category']] ?? $row['category'],
        ]), $osdr['indicator_reference']), 'indicator'));
        $this->components->task('Health indicators', fn () => $this->upsertById('health_indicators', array_map(
            fn (array $card): array => $this->translate($card, $english['indicators'][$card['_id']] ?? []),
            $knowledge['health_indicators'],
        ), '_id'));
        $this->components->task('Advice cards (non-normative)', fn () => $this->importAdviceCards(array_map(function (array $card) use ($english): array {
            $text = $english['advice'][$card['_id']] ?? [];

            return $this->translate($card, array_filter([
                'title' => $text['title'] ?? null,
                'condition' => $text['condition'] ?? null,
                'body' => $text['body'] ?? null,
                'do_not' => $text['doNot'] ?? null,
            ]));
        }, $knowledge['advice_cards'])));
        $this->components->task('NASA HRP hazards', fn () => $this->upsertById('hazards', array_map(
            fn (array $hazard): array => $this->translate($hazard, $english['hazards'][$hazard['_id']] ?? []),
            $knowledge['hazards'],
        ), '_id'));
        $this->components->task('Knowledge documents', fn () => $this->upsertById('knowledge_documents', [
            ...array_map(fn (array $document): array => [...$document, 'language' => 'fr', 'topics' => ['nasa_hrp'], 'validated' => true], $knowledge['rag_documents']),
            ...array_map(fn (array $document): array => [...$document, 'language' => 'en'], $vision['documents']),
        ], 'id'));
        $this->components->task('Dataset provenance', fn () => $this->recordProvenance([
            'osdr_seed' => [$osdrFile, $osdr['_meta']],
            'knowledge_seed' => [$knowledgeFile, $knowledge['_meta']],
            'osdr_manifest' => [$manifestFile, ['source' => $manifest['source'] ?? null, 'files' => $manifest['files'] ?? []]],
            'vision_knowledge' => [$visionFile, $vision['_meta']],
            'reference_en' => [$englishFile, $english['_meta']],
        ]));

        $this->components->info(sprintf(
            '%d OSDR measurements available in "%s".',
            $this->collection('osdr_measurements')->countDocuments(),
            DB::connection('mongodb')->getDatabaseName(),
        ));

        return self::SUCCESS;
    }

    /**
     * @param  list<array<string, mixed>>  $measurements
     * @param  array<string, mixed>  $meta
     */
    private function importMeasurements(array $measurements, array $meta): void
    {
        $this->collection('osdr_measurements')->createIndex(
            ['subjectId' => 1, 'indicator' => 1, 'timepoint' => 1, 'study' => 1],
            ['name' => 'osdr_unique', 'unique' => true],
        );

        $operations = [];

        foreach ($measurements as $measurement) {
            $key = [
                'subjectId' => $measurement['subjectId'],
                'indicator' => $measurement['indicator'],
                'timepoint' => $measurement['timepoint'],
                'study' => $measurement['study'],
            ];

            $operations[] = ['replaceOne' => [$key, [
                ...$measurement,
                'relativeDay' => $this->relativeDay($measurement['timepoint']),
                'anchor' => str_starts_with($measurement['timepoint'], 'L') ? 'launch' : 'return',
                'quality' => is_numeric($measurement['value']) ? 'valid' : 'missing',
                'dataOrigin' => 'nasa_osdr',
                'caveat' => $meta['warning'],
            ], ['upsert' => true]]];

            if (count($operations) === 1000) {
                $this->collection('osdr_measurements')->bulkWrite($operations, ['ordered' => false]);
                $operations = [];
            }
        }

        if ($operations !== []) {
            $this->collection('osdr_measurements')->bulkWrite($operations, ['ordered' => false]);
        }
    }

    /**
     * Advice cards from the data bank use green/orange/red bands and z-scores.
     * The cahier des charges (p.13-14) keeps those as hypotheses: they are
     * stored for education only and never trigger an alert.
     *
     * @param  list<array<string, mixed>>  $cards
     */
    private function importAdviceCards(array $cards): void
    {
        $cards = array_map(fn (array $card): array => [
            ...$card,
            'normative' => false,
            'usage' => 'educational_context_only',
            'disclaimer' => 'Not a mission rule. Thresholds require a validated mission medical policy.',
        ], $cards);

        $this->upsertById('advice_cards', $cards, '_id');
    }

    /**
     * English becomes the displayed text (public deliverables are in English);
     * the original French values are kept under translations.fr.
     *
     * @param  array<string, mixed>  $document
     * @param  array<string, string>  $english
     * @return array<string, mixed>
     */
    private function translate(array $document, array $english): array
    {
        if ($english === []) {
            return [...$document, 'language' => 'fr'];
        }

        $original = array_intersect_key($document, $english);

        return [...$document, ...$english, 'language' => 'en', 'translations' => ['fr' => $original]];
    }

    /**
     * @param  list<array<string, mixed>>  $documents
     */
    private function upsertById(string $collection, array $documents, string $idField): void
    {
        $operations = array_map(function (array $document) use ($idField): array {
            $id = $document[$idField];
            unset($document['_id']);

            return ['replaceOne' => [['_id' => $id], $document, ['upsert' => true]]];
        }, $documents);

        $this->collection($collection)->bulkWrite($operations, ['ordered' => false]);
    }

    /**
     * @param  array<string, array{0: string, 1: array<string, mixed>}>  $sources
     */
    private function recordProvenance(array $sources): void
    {
        foreach ($sources as $id => [$file, $meta]) {
            $this->collection('datasets')->replaceOne(['_id' => $id], [
                'file' => basename($file),
                'sha256' => hash_file('sha256', $file),
                'bytes' => filesize($file),
                'licence' => $meta['license'] ?? self::Licence,
                'meta' => $meta,
                'importedAt' => new UTCDateTime(now('UTC')),
            ], ['upsert' => true]);
        }
    }

    /**
     * "L-92" -> -92 (days before launch), "R+45" -> 45 (days after return).
     */
    private function relativeDay(string $timepoint): ?int
    {
        return preg_match('/^[LR]([+-]\d+)$/', $timepoint, $matches) === 1 ? (int) $matches[1] : null;
    }

    /**
     * @return array<string, mixed>
     */
    private function readJson(string $file): array
    {
        return json_decode((string) file_get_contents($file), true, flags: JSON_THROW_ON_ERROR);
    }

    private function collection(string $name): Collection
    {
        return DB::connection('mongodb')->getCollection($name);
    }
}
