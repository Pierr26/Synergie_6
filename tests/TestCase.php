<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\Facades\DB;
use MongoDB\Collection;

abstract class TestCase extends BaseTestCase
{
    /**
     * HEXTA API feature tests run against the "hexta_test" MongoDB database (phpunit.xml).
     * It is dropped before each test so every test starts from an empty state.
     */
    protected function freshMongoDatabase(): void
    {
        $this->assertSame('hexta_test', DB::connection('mongodb')->getDatabaseName());

        DB::connection('mongodb')->getDatabase()->drop();
    }

    protected function mongoCollection(string $name): Collection
    {
        return DB::connection('mongodb')->getCollection($name);
    }
}
