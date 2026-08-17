<?php

namespace Database\Factories;

use App\Models\BreakGlassGrant;
use App\Models\Tenant;
use App\Models\User;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Date;

/**
 * The default state is a LIVE grant: notified, unrevoked, two hours to run.
 *
 * The interesting states are the ones that must refuse — expired, revoked and
 * unnotified each have their own state below, because a control is only proven
 * by the cases it denies.
 *
 * @extends Factory<BreakGlassGrant>
 */
class BreakGlassGrantFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'tenant_id' => Tenant::factory(),

            // A platform operator: no tenant_id, because Carevelo staff belong
            // to no clinic.
            'operator_id' => User::factory(),

            'reason' => 'Ticket CV-'.fake()->numerify('####')
                .': the clinic reports a record it cannot open and has asked us to look.',
            'scope' => fake()->randomElement(BreakGlassGrant::SCOPES),
            'granted_at' => Date::now(),
            'expires_at' => Date::now()->addHours(2),
            'tenant_notified_at' => Date::now(),
        ];
    }

    /** The time box elapsed. Permits nothing. */
    public function expired(): static
    {
        return $this->state(fn () => [
            'granted_at' => Date::now()->subHours(6),
            'expires_at' => Date::now()->subHour(),
        ]);
    }

    /** Ended early. Permits nothing. */
    public function revoked(): static
    {
        return $this->state(fn () => ['revoked_at' => Date::now()]);
    }

    /** Issued but the clinic was never told, so it is not yet a grant. */
    public function unnotified(): static
    {
        return $this->state(fn () => ['tenant_notified_at' => null]);
    }

    public function forScope(string $scope): static
    {
        return $this->state(fn () => ['scope' => $scope]);
    }
}
