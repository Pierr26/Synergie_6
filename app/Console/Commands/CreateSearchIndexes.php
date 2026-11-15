<?php

namespace App\Console\Commands;

use Illuminate\Console\Attributes\Description;
use Illuminate\Console\Attributes\Signature;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Throwable;

/**
 * Creates (or updates) the Atlas Search index used by the vision agent.
 * Works on MongoDB Atlas and on the mongodb/mongodb-atlas-local image.
 */
#[Signature('hexta:search-indexes')]
#[Description('Create or update the Atlas Search index on knowledge_documents')]
class CreateSearchIndexes extends Command
{
    public function handle(): int
    {
        $collection = DB::connection('mongodb')->getCollection('knowledge_documents');
        $name = config('hexta.atlas_search.index');
        $definition = [
            'mappings' => [
                'dynamic' => false,
                'fields' => [
                    'title' => ['type' => 'string', 'analyzer' => 'lucene.english'],
                    'text' => ['type' => 'string', 'analyzer' => 'lucene.english'],
                    'topics' => ['type' => 'token'],
                    'validated' => ['type' => 'boolean'],
                ],
            ],
        ];

        try {
            $existing = array_column(iterator_to_array($collection->listSearchIndexes(), false), 'name');

            if (in_array($name, $existing, true)) {
                $collection->updateSearchIndex($name, $definition);
                $this->components->info("Atlas Search index \"{$name}\" updated.");
            } else {
                $collection->createSearchIndex($definition, ['name' => $name]);
                $this->components->info("Atlas Search index \"{$name}\" created. It becomes queryable after the initial sync.");
            }
        } catch (Throwable $exception) {
            $this->components->error('Atlas Search is not available on this server: '.$exception->getMessage());
            $this->components->warn('Keep HEXTA_ATLAS_SEARCH=false: the agent will use the $text index.');

            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
