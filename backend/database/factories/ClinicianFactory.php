<?php

namespace Database\Factories;

use App\Models\Clinician;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;

/** @extends Factory<Clinician> */
class ClinicianFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'user_id' => User::factory(),
            'registration_body' => 'umdpc',
            'registration_number' => 'UMDPC-'.fake()->unique()->numerify('#####'),
            'specialty' => 'General Practice',
            'can_prescribe' => true,
        ];
    }

    /** A clinician who has not been given prescribing rights. */
    public function cannotPrescribe(): static
    {
        return $this->state(fn () => ['can_prescribe' => false]);
    }

    public function withoutRegistrationNumber(): static
    {
        return $this->state(fn () => ['registration_number' => '']);
    }

    public function withExpiredLicence(): static
    {
        return $this->state(fn () => ['practising_licence_expires_at' => now()->subMonth()]);
    }
}
