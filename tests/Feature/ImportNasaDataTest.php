<?php

namespace Tests\Feature;

use Tests\TestCase;

class ImportNasaDataTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->freshMongoDatabase();
    }

    public function test_import_is_idempotent_and_traceable(): void
    {
        $this->artisan('hexta:import-nasa-data')->assertSuccessful();
        $this->artisan('hexta:import-nasa-data')->assertSuccessful();

        $this->assertSame(7768, $this->mongoCollection('osdr_measurements')->countDocuments());
        $this->assertSame(5, $this->mongoCollection('hazards')->countDocuments());
        $this->assertSame(5, $this->mongoCollection('datasets')->countDocuments());

        $dataset = $this->mongoCollection('datasets')->findOne(['_id' => 'osdr_seed']);
        $this->assertSame(hash_file('sha256', database_path('data/nasa/osdr_seed.json')), $dataset['sha256']);
        $this->assertSame('CC0-1.0', $dataset['licence']);
    }

    public function test_measurements_keep_provenance_and_relative_day(): void
    {
        $this->artisan('hexta:import-nasa-data')->assertSuccessful();

        $hemoglobin = $this->mongoCollection('osdr_measurements')->findOne([
            'subjectId' => 'C001', 'indicator' => 'hemoglobin', 'timepoint' => 'L-92',
        ]);

        $this->assertSame(14.1, $hemoglobin['value']);
        $this->assertSame('g/dL', $hemoglobin['unit']);
        $this->assertSame(-92, $hemoglobin['relativeDay']);
        $this->assertSame('launch', $hemoglobin['anchor']);
        $this->assertSame('OSD-569', $hemoglobin['study']);
        $this->assertSame('10.26030/e0rx-sh52', $hemoglobin['doi']);
    }

    public function test_advice_cards_are_flagged_as_non_normative(): void
    {
        $this->artisan('hexta:import-nasa-data')->assertSuccessful();

        $this->assertSame(0, $this->mongoCollection('advice_cards')->countDocuments(['normative' => ['$ne' => false]]));
    }
}
