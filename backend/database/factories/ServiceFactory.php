<?php

namespace Database\Factories;

use App\Models\Service;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Service> */
class ServiceFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'name' => fake()->randomElement(['General Consultation', 'Follow-up', 'Antenatal Review']),
            'duration_minutes' => 30,
            'price_minor' => 3_000_000,
            'currency' => 'UGX',
            'modes' => ['video', 'voice', 'chat'],
            'is_active' => true,
        ];
    }
}
