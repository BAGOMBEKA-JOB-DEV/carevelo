<?php

namespace Database\Factories;

use App\Models\Patient;
use App\Models\PatientStatus;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * @extends Factory<Patient>
 */
class PatientFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'given_name' => fake()->firstName(),
            'family_name' => fake()->lastName(),
            'phone' => '+2567'.fake()->unique()->numerify('########'),
            'status' => PatientStatus::Active,
            'phone_verified_at' => now(),
        ];
    }

    public function pendingConsent(): static
    {
        return $this->state(fn () => [
            'status' => PatientStatus::PendingConsent,
            'phone_verified_at' => null,
        ]);
    }
}
