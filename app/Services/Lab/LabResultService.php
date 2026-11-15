<?php

namespace App\Services\Lab;

use App\Services\Workspace\WorkspaceClock;
use App\Support\CanonicalJson;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use MongoDB\BSON\UTCDateTime;
use MongoDB\Collection;

/**
 * Haemoglobin and haematocrit results entered by the CMO (M12, p.10-11).
 *
 * Original value and unit are kept; each correction is a new version with
 * status "corrected" and verified=false, which suspends the interval
 * comparison until the CMO verifies it. The comparison is computed on read
 * from the result interval, or else from the workspace policy interval.
 */
final class LabResultService
{
    private const array TypeMap = ['root' => 'array', 'document' => 'array', 'array' => 'array'];

    private const array ContentFields = ['analyte', 'value', 'unit', 'specimen', 'method', 'laboratory', 'collectedAt', 'analyzedAt', 'issuedAt', 'status', 'labFlag', 'interval', 'sourceText'];

    public function __construct(
        private readonly WorkspaceClock $clock,
        private readonly LabIntervalEvaluator $evaluator,
    ) {}

    /**
     * @param  array<string, mixed>  $input
     * @return array{result: array<string, mixed>, created: bool}
     */
    public function create(string $workspaceId, string $crewId, array $input): array
    {
        $lineageId = $input['resultId'];
        $current = $this->current($workspaceId, $lineageId);
        $document = $this->buildDocument($workspaceId, $crewId, $lineageId, $input);

        if ($current !== null) {
            if ($current['subjectId'] !== $crewId || $this->hash($current) !== $this->hash($document)) {
                throw new LabResultException('A different result already exists with this resultId. Send a correction instead.');
            }

            return ['result' => $this->present($workspaceId, $current), 'created' => false];
        }

        $document['_id'] = "{$lineageId}-v1";
        $document['version'] = 1;
        $document['verified'] = in_array($document['status'], LabIntervalEvaluator::VerifiedStatuses, true);
        $this->collection()->insertOne($document);

        return ['result' => $this->present($workspaceId, $this->current($workspaceId, $lineageId)), 'created' => true];
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    public function correct(string $workspaceId, string $lineageId, array $input): array
    {
        $current = $this->current($workspaceId, $lineageId) ?? throw new LabResultNotFoundException;
        $document = $this->buildDocument($workspaceId, $current['subjectId'], $lineageId, [...$current, ...$input, 'status' => 'corrected', 'enteredBy' => $input['correctedBy']]);
        $version = $current['version'] + 1;

        $document['_id'] = "{$lineageId}-v{$version}";
        $document['version'] = $version;
        $document['verified'] = false;
        $document['correctionReason'] = $input['reason'];
        $document['supersedes'] = $current['_id'];

        $this->collection()->insertOne($document);
        $this->collection()->updateOne(['_id' => $current['_id']], ['$set' => ['current' => false, 'supersededBy' => $document['_id']]]);

        return $this->present($workspaceId, $this->current($workspaceId, $lineageId));
    }

    /**
     * @return array<string, mixed>
     */
    public function verify(string $workspaceId, string $lineageId, string $cmoId): array
    {
        $current = $this->current($workspaceId, $lineageId) ?? throw new LabResultNotFoundException;

        $this->collection()->updateOne(['_id' => $current['_id']], ['$set' => [
            'verified' => true,
            'verifiedBy' => $cmoId,
            'verifiedAt' => new UTCDateTime($this->clock->now($workspaceId)),
        ]]);

        return $this->present($workspaceId, $this->current($workspaceId, $lineageId));
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function list(string $workspaceId, string $crewId): array
    {
        $cursor = $this->collection()->find(
            ['workspaceId' => $workspaceId, 'subjectId' => $crewId, 'current' => true],
            ['sort' => ['collectedAt' => -1, '_id' => 1], 'typeMap' => self::TypeMap],
        );

        return array_map(fn (array $result): array => $this->present($workspaceId, $result), iterator_to_array($cursor, false));
    }

    /**
     * @return list<array<string, mixed>>
     */
    public function history(string $workspaceId, string $lineageId): array
    {
        return iterator_to_array($this->collection()->find(
            ['workspaceId' => $workspaceId, 'lineageId' => $lineageId],
            ['sort' => ['version' => 1], 'typeMap' => self::TypeMap],
        ), false);
    }

    /**
     * Adds the interval comparison, processing delay and review flags.
     *
     * @param  array<string, mixed>  $result
     * @return array<string, mixed>
     */
    public function present(string $workspaceId, array $result): array
    {
        $interval = $result['interval'] ?? ($this->clock->workspace($workspaceId)['policy']['labIntervals'][$result['analyte']] ?? null);
        $collectedAt = $this->date($result['collectedAt'] ?? null);
        $analyzedAt = $this->date($result['analyzedAt'] ?? null);

        $result['evaluation'] = [
            ...$this->evaluator->evaluate([
                'analyte' => $result['analyte'],
                'value' => $result['value'],
                'unit' => $result['unit'],
                'status' => $result['status'],
                'verified' => $result['verified'] ?? false,
            ], $interval),
            'interval' => $interval,
            'intervalOrigin' => isset($result['interval']) ? 'result' : ($interval === null ? null : 'workspace_policy'),
        ];
        $result['processingDelayMinutes'] = $collectedAt && $analyzedAt ? (int) round($collectedAt->diffInMinutes($analyzedAt)) : null;
        $result['reviewFlags'] = array_values(array_filter([
            $collectedAt === null ? 'collection_time_missing' : null,
            ($result['unit'] ?? null) === null ? 'unit_missing' : null,
            ! ($result['verified'] ?? false) ? 'verification_pending' : null,
        ]));
        $result['reportable'] = $collectedAt !== null;

        return $result;
    }

    /**
     * @return array<string, mixed>|null
     */
    private function current(string $workspaceId, string $lineageId): ?array
    {
        return $this->collection()->findOne(['workspaceId' => $workspaceId, 'lineageId' => $lineageId, 'current' => true], ['typeMap' => self::TypeMap]);
    }

    /**
     * @param  array<string, mixed>  $input
     * @return array<string, mixed>
     */
    private function buildDocument(string $workspaceId, string $crewId, string $lineageId, array $input): array
    {
        $toDate = fn (mixed $value): ?UTCDateTime => match (true) {
            $value instanceof UTCDateTime => $value,
            is_string($value) && $value !== '' => new UTCDateTime(CarbonImmutable::parse($value)->utc()),
            default => null,
        };

        return [
            'workspaceId' => $workspaceId,
            'missionId' => $this->clock->missionId($workspaceId),
            'subjectId' => $crewId,
            'analyte' => $input['analyte'],
            'loinc' => LabIntervalEvaluator::Analytes[$input['analyte']]['loinc'],
            'value' => $input['value'],
            'unit' => $input['unit'] ?? null,
            'specimen' => $input['specimen'] ?? null,
            'method' => $input['method'] ?? null,
            'laboratory' => $input['laboratory'] ?? null,
            'collectedAt' => $toDate($input['collectedAt'] ?? null),
            'analyzedAt' => $toDate($input['analyzedAt'] ?? null),
            'issuedAt' => $toDate($input['issuedAt'] ?? null),
            'status' => $input['status'],
            'labFlag' => $input['labFlag'] ?? null,
            'interval' => $input['interval'] ?? null,
            'sourceText' => $input['sourceText'] ?? null,
            'enteredBy' => ['crewId' => is_array($input['enteredBy']) ? $input['enteredBy']['crewId'] : $input['enteredBy'], 'role' => 'cmo'],
            'source' => $input['source'] ?? 'cmo_entry',
            'lineageId' => $lineageId,
            'current' => true,
            'recordedAt' => new UTCDateTime(now('UTC')),
        ];
    }

    /**
     * @param  array<string, mixed>  $document
     */
    private function hash(array $document): string
    {
        $content = array_intersect_key($document, array_flip(self::ContentFields));

        foreach (['collectedAt', 'analyzedAt', 'issuedAt'] as $field) {
            $content[$field] = isset($content[$field]) ? $content[$field]->toDateTime()->getTimestamp() : null;
        }

        return CanonicalJson::sha256($content);
    }

    private function date(mixed $value): ?CarbonImmutable
    {
        return $value instanceof UTCDateTime ? CarbonImmutable::instance($value->toDateTime()) : null;
    }

    private function collection(): Collection
    {
        return DB::connection('mongodb')->getCollection('lab_results');
    }
}
