<?php

namespace Database\Factories;

use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Models\PaymentMethod;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/** @extends Factory<PaymentIntent> */
class PaymentIntentFactory extends Factory
{
    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'reference' => 'PAY-2608-'.Str::padLeft((string) fake()->unique()->numberBetween(1, 9999), 4, '0'),
            'payable_type' => 'appointment',
            'payable_id' => (string) Str::ulid(),
            'amount_minor' => 3_000_000,
            'currency' => 'UGX',
            'method' => PaymentMethod::MtnMomo,
            'aggregator' => 'flutterwave',
            'idempotency_key' => (string) Str::uuid(),
            'status' => PaymentIntentStatus::Pending,
            'initiated_at' => now(),
        ];
    }

    public function timedOut(): static
    {
        return $this->state(fn () => ['status' => PaymentIntentStatus::TimedOut]);
    }

    public function succeeded(): static
    {
        return $this->state(fn () => [
            'status' => PaymentIntentStatus::Succeeded,
            'resolved_at' => now(),
        ]);
    }
}
