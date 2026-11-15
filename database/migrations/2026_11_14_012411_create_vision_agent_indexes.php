<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Indexes for the vision agent: analyses history, GridFS photo lookup by
 * workspace and crew member, and the $text fallback used when Atlas Search
 * is not available.
 */
return new class extends Migration
{
    protected $connection = 'mongodb';

    public function up(): void
    {
        $database = DB::connection('mongodb')->getDatabase();

        $database->selectCollection('analyses')->createIndex(
            ['workspaceId' => 1, 'subjectId' => 1, 'createdAt' => -1],
            ['name' => 'analysis_by_subject'],
        );

        $database->selectCollection(config('hexta.media.bucket').'.files')->createIndex(
            ['metadata.workspaceId' => 1, 'metadata.subjectId' => 1, 'uploadDate' => -1],
            ['name' => 'media_by_subject'],
        );

        $database->selectCollection('knowledge_documents')->createIndex(
            ['title' => 'text', 'text' => 'text'],
            ['name' => 'knowledge_text', 'weights' => ['title' => 5, 'text' => 1], 'default_language' => 'none'],
        );
    }

    public function down(): void
    {
        $database = DB::connection('mongodb')->getDatabase();

        $database->selectCollection('analyses')->dropIndex('analysis_by_subject');
        $database->selectCollection(config('hexta.media.bucket').'.files')->dropIndex('media_by_subject');
        $database->selectCollection('knowledge_documents')->dropIndex('knowledge_text');
    }
};
