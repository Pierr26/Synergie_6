<?php

namespace Tests\Feature;

use Tests\TestCase;

class AppShellTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->withoutVite();
    }

    public function test_root_and_internal_views_serve_the_same_shell(): void
    {
        foreach (['/', '/overview', '/check-in', '/crew', '/reports', '/body'] as $path) {
            $this->get($path)
                ->assertOk()
                ->assertSee('id="app"', false)
                ->assertSee('Simulated crew data', false);
        }
    }

    public function test_unknown_paths_are_not_swallowed_by_the_shell(): void
    {
        $this->get('/does-not-exist')->assertNotFound();
    }
}
