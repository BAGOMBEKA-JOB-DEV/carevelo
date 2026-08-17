<?php

namespace Database\Factories;

use App\Models\ClinicalRole;
use App\Models\StaffInvitation;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Date;

/** @extends Factory<StaffInvitation> */
class StaffInvitationFactory extends Factory
{
    /**
     * The plaintext behind the default digest.
     *
     * Only ever a fixture. Real tokens come from StaffInvitation::issue(), which
     * is the only place 256 bits of randomness is generated, and the only place
     * the plaintext exists.
     */
    public const KNOWN_TOKEN = 'factory-invitation-token';

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'phone' => '+2567'.fake()->numerify('########'),
            'name' => fake()->name(),
            'role' => ClinicalRole::FrontDesk->value,
            'token_hash' => StaffInvitation::hashToken(self::KNOWN_TOKEN),
            'expires_at' => Date::now()->addDays(StaffInvitation::EXPIRES_AFTER_DAYS),
        ];
    }

    public function forRole(ClinicalRole $role): static
    {
        return $this->state(fn () => ['role' => $role->value]);
    }

    public function expired(): static
    {
        return $this->state(fn () => [
            'expires_at' => Date::now()->subDay(),
        ]);
    }

    public function accepted(): static
    {
        return $this->state(fn () => [
            'accepted_at' => Date::now()->subHour(),
        ]);
    }
}
