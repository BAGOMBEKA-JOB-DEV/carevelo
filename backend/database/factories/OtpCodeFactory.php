<?php

namespace Database\Factories;

use App\Models\OtpCode;
use App\Support\Auth\OtpPurpose;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\Hash;

/** @extends Factory<OtpCode> */
class OtpCodeFactory extends Factory
{
    /**
     * The plaintext behind the default digest.
     *
     * Exposed as a constant so a test can submit it without reaching for the
     * hash. Fixed rather than random because a test asserting on verification
     * needs to know what the right answer is.
     */
    public const KNOWN_CODE = '424242';

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'phone' => '+2567'.fake()->numerify('########'),
            'code_hash' => Hash::make(self::KNOWN_CODE),
            'purpose' => OtpPurpose::SignIn,
            'expires_at' => Date::now()->addMinutes(OtpCode::TTL_MINUTES),
            'attempts' => 0,
            'ip_address' => fake()->ipv4(),
        ];
    }

    public function expired(): static
    {
        return $this->state(fn () => [
            'expires_at' => Date::now()->subMinute(),
        ]);
    }

    /** Already spent. Kept, not deleted, so a replay is recognisable. */
    public function consumed(): static
    {
        return $this->state(fn () => [
            'consumed_at' => Date::now()->subMinute(),
        ]);
    }

    public function exhausted(): static
    {
        return $this->state(fn () => [
            'attempts' => OtpCode::MAX_ATTEMPTS,
            'consumed_at' => Date::now(),
        ]);
    }
}
