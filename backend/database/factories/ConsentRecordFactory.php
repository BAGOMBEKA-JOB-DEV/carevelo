<?php

namespace Database\Factories;

use App\Http\Controllers\Api\V1\ConsentController;
use App\Models\ConsentRecord;
use App\Models\Patient;
use Illuminate\Database\Eloquent\Factories\Factory;

/**
 * ConsentRecord deliberately does not use HasFactory: it is an evidence row,
 * and `ConsentRecord::factory()` sitting on the model invites production code
 * to reach for it. Build fixtures explicitly instead:
 *
 *     ConsentRecordFactory::new()->create(['patient_id' => $patient->id]);
 *
 * The version and hash come from the live policy rather than a literal, so a
 * wording change that nobody versioned shows up as a failing test here rather
 * than as an unreproducible hash in production.
 *
 * @extends Factory<ConsentRecord>
 */
class ConsentRecordFactory extends Factory
{
    /**
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        return [
            'patient_id' => Patient::factory(),
            'consent_type' => 'data_processing',
            'policy_version' => ConsentController::POLICY_VERSION,
            'policy_text_hash' => hash('sha256', ConsentController::POLICY_VERSION),
            'action' => 'granted',
            'granted_by' => 'patient',
            'occurred_at' => now(),
        ];
    }

    public function telemedicine(): static
    {
        return $this->state(fn () => ['consent_type' => 'telemedicine']);
    }

    public function deliveryDisclosure(): static
    {
        return $this->state(fn () => ['consent_type' => 'delivery_disclosure']);
    }

    public function declined(): static
    {
        return $this->state(fn () => ['action' => 'declined']);
    }

    /** Withdrawal is a NEW record, so this is a state, never an update. */
    public function withdrawn(): static
    {
        return $this->state(fn () => ['action' => 'withdrawn']);
    }

    public function byGuardian(): static
    {
        return $this->state(fn () => [
            'granted_by' => 'guardian',
            'guardian_name' => fake()->name(),
            'guardian_relationship' => 'mother',
        ]);
    }
}
