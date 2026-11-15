<?php

namespace Tests\Feature;

use Tests\TestCase;

class NasaDataTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();

        $this->freshMongoDatabase();
        $this->artisan('migrate', ['--force' => true])->assertSuccessful();
        $this->artisan('hexta:import-nasa-data')->assertSuccessful();
    }

    public function test_osdr_series_is_ordered_from_launch_to_return_with_provenance(): void
    {
        $response = $this->getJson(route('api.v1.nasa.osdr.series', ['indicator' => 'hemoglobin', 'subjectId' => 'C001']))->assertOk();

        $response->assertHeader('Cache-Control', 'max-age=86400, public')
            ->assertJsonPath('data.unit', 'g/dL')
            ->assertJsonPath('data.source.study', 'OSD-569')
            ->assertJsonPath('data.source.licence', 'CC0-1.0')
            ->assertJsonPath('data.source.methodLabel', 'NASA OSDR instrumented record');

        $points = $response->json('data.series.0.points');
        $this->assertSame(['L-92', 'L-44', 'L-3', 'R+1', 'R+45', 'R+82', 'R+194'], array_column($points, 'timepoint'));
        $this->assertSame(14.1, $points[0]['value']);
        $this->assertCount(4, $this->getJson(route('api.v1.nasa.osdr.series', ['indicator' => 'hemoglobin']))->json('data.series'));
    }

    public function test_unknown_series_and_invalid_subject_are_rejected(): void
    {
        $this->getJson(route('api.v1.nasa.osdr.series', ['indicator' => 'unknown_marker']))->assertNotFound();
        $this->getJson(route('api.v1.nasa.osdr.series', ['indicator' => 'hemoglobin', 'subjectId' => 'X9']))->assertUnprocessable();
    }

    public function test_hazards_link_to_indicator_cards(): void
    {
        $this->getJson(route('api.v1.nasa.hazards'))->assertOk()->assertJsonCount(5, 'data');

        $hazard = $this->getJson(route('api.v1.nasa.hazard', 'space_radiation'))->assertOk()->json('data');
        $this->assertSame('https://www.nasa.gov/hrp/hazard-space-radiation/', $hazard['nasaUrl']);
        $this->assertSame('Space radiation', $hazard['label']);
        $this->assertContains('bloodPressure', array_column($hazard['indicatorCards'], '_id'));

        $this->getJson(route('api.v1.nasa.hazard', 'unknown'))->assertNotFound();
    }

    public function test_indicator_card_carries_non_normative_advice(): void
    {
        $card = $this->getJson(route('api.v1.nasa.indicator', 'glucose'))->assertOk()->json('data');

        $this->assertSame('mg/dL', $card['unit']);
        $this->assertSame('Blood glucose', $card['label']);
        $this->assertSame('Glycémie', $card['translations']['fr']['label']);
        $this->assertNotEmpty($card['whyItMatters']);
        $this->assertContains('Glucose below the reference range', array_column($card['adviceCards'], 'title'));
        $this->assertNotEmpty($card['adviceCards']);
        $this->assertFalse($card['adviceCards'][0]['normative']);
    }

    public function test_datasets_expose_their_fingerprints(): void
    {
        $datasets = collect($this->getJson(route('api.v1.nasa.datasets'))->assertOk()->json('data'))->keyBy('_id');

        $this->assertSame(hash_file('sha256', database_path('data/nasa/osdr_seed.json')), $datasets['osdr_seed']['sha256']);
        $this->assertCount(5, $datasets);
    }

    public function test_bone_loss_card_mentions_no_medication(): void
    {
        $this->artisan('hexta:import-nasa-data', ['--knowledge-only' => true])->assertSuccessful();
        $card = $this->mongoCollection('advice_cards')->findOne(['_id' => 'advice-bone-loss']);

        $this->assertStringNotContainsStringIgnoringCase('alendronate', $card['body']);
        $this->assertStringNotContainsStringIgnoringCase('bisphosphonate', $card['body']);
    }

    public function test_knowledge_search_endpoint(): void
    {
        $this->getJson(route('api.v1.nasa.knowledge', ['q' => 'webcam pulse photoplethysmography']))
            ->assertOk()
            ->assertJsonPath('data.0.id', 'vision-rppg-method');
    }

    public function test_atlas_check_command_proves_the_receiver(): void
    {
        $this->artisan('hexta:atlas-check')->assertSuccessful();

        $proof = $this->mongoCollection('atlas_checks')->findOne();
        $this->assertTrue($proof['passed']);
        $this->assertCount(7, $proof['steps']);
        $this->assertSame(1, $this->mongoCollection('reports')->countDocuments());
    }
}
