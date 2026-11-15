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
        // Factories rely on Faker, a dev-only dependency: production seeds only the NASA data and the demo.
        if (app()->environment('local', 'testing')) {
            User::factory()->create([
                'name' => 'Test User',
                'email' => 'test@example.com',
            ]);
        }

        $this->command->call('hexta:import-nasa-data');
        $scenario->install();
    }
}
