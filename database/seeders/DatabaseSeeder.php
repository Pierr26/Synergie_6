<?php

namespace Database\Seeders;

use App\Models\User;
use App\Services\Demo\DemoScenario;
use Illuminate\Database\Console\Seeds\WithoutModelEvents;
use Illuminate\Database\Seeder;

class DatabaseSeeder extends Seeder
{
    use WithoutModelEvents;

    /**
     * Seed the application's database.
     */
    public function run(DemoScenario $scenario): void
    {
        // User::factory(10)->create();

        User::factory()->create([
            'name' => 'Test User',
            'email' => 'test@example.com',
        ]);

        $this->command->call('hexta:import-nasa-data');
        $scenario->install();
    }
}
