<?php

namespace App\Services\Agent;

use Illuminate\Support\Facades\DB;
use MongoDB\Collection;

/**
 * Retrieval over `knowledge_documents` for the vision agent.
 *
 * On MongoDB Atlas (or the atlas-local image) it uses Atlas Search with a
 * fuzzy full-text query; on a plain MongoDB server it falls back to the
 * `$text` index created by the migrations. Both paths return the same shape.
 */
final class KnowledgeSearch
{
    private const int ExcerptLength = 900;

    /**
     * @param  list<string>  $topics
     * @return list<array{id: string, title: string, source: string, url: ?string, authority: ?string, validated: bool, excerpt: string, score: float}>
     */
    public function search(string $query, array $topics = [], int $limit = 4): array
    {
        $limit = max(1, min($limit, 8));
        $pipeline = config('hexta.atlas_search.enabled')
            ? $this->atlasSearchPipeline($query, $topics, $limit)
            : $this->textSearchPipeline($query, $topics, $limit);

        $results = [];

        foreach ($this->collection()->aggregate($pipeline, ['typeMap' => ['root' => 'array', 'document' => 'array', 'array' => 'array']]) as $document) {
            $results[] = [
                'id' => (string) $document['_id'],
                'title' => (string) $document['title'],
                'source' => (string) ($document['source'] ?? ''),
                'url' => $document['url'] ?? null,
                'authority' => $document['authority'] ?? null,
                'validated' => (bool) ($document['validated'] ?? false),
                'excerpt' => mb_substr((string) $document['text'], 0, self::ExcerptLength),
                'score' => round((float) ($document['score'] ?? 0), 3),
            ];
        }

        return $results;
    }

    /**
     * @param  list<string>  $topics
     * @return list<array<string, mixed>>
     */
    private function atlasSearchPipeline(string $query, array $topics, int $limit): array
    {
        $compound = [
            'must' => [['text' => ['query' => $query, 'path' => ['title', 'text'], 'fuzzy' => ['maxEdits' => 1]]]],
        ];

        if ($topics !== []) {
            $compound['should'] = [['in' => ['path' => 'topics', 'value' => $topics, 'score' => ['boost' => ['value' => 2]]]]];
        }

        return [
            ['$search' => ['index' => config('hexta.atlas_search.index'), 'compound' => $compound]],
            ['$limit' => $limit],
            ['$addFields' => ['score' => ['$meta' => 'searchScore']]],
        ];
    }

    /**
     * @param  list<string>  $topics
     * @return list<array<string, mixed>>
     */
    private function textSearchPipeline(string $query, array $topics, int $limit): array
    {
        return [
            ['$match' => ['$text' => ['$search' => $query]]],
            ['$addFields' => [
                'score' => ['$add' => [
                    ['$meta' => 'textScore'],
                    ['$cond' => [['$gt' => [['$size' => ['$setIntersection' => [['$ifNull' => ['$topics', []]], $topics]]], 0]], 1, 0]],
                ]],
            ]],
            ['$sort' => ['score' => -1, '_id' => 1]],
            ['$limit' => $limit],
        ];
    }

    private function collection(): Collection
    {
        return DB::connection('mongodb')->getCollection('knowledge_documents');
    }
}
