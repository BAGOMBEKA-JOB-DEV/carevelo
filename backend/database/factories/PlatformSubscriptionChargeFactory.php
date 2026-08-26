<?php

namespace Database\Factories;

use App\Models\PlatformSubscriptionCharge;
use App\Models\SubscriptionChargeStatus;
use App\Models\SubscriptionPlan;
use App\Models\Tenant;
use App\Support\Money;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Str;

/**
 * @extends Factory<PlatformSubscriptionCharge>
 */
class PlatformSubscriptionChargeFactory extends Factory
{
    /**
     * A realistic monthly plan, so an amount-mismatch test is testing the
     * arithmetic rather than a round number that happens to work either way.
     *
     * UGX 250,000 is 25,000,000 minor units. A conversion wrong by that factor
     * is the defect the fraud boundary exists to catch.
     *
     * @return array<string, mixed>
     */
    public function definition(): array
    {
        $start = CarbonImmutable::instance(Date::now())->startOfDay();

        return [
            // Deliberately NOT Tenant::factory(): a charge names a clinic, and a
            // test that wants one usually already has it. Overriding a lazily
            // created tenant is how a test ends up asserting against the wrong
            // one.
            'tenant_id' => Tenant::factory(),
            'plan' => SubscriptionPlan::Clinic,
            'amount' => Money::ugx(250_000),
            'period_starts_on' => $start,
            'period_ends_on' => $start->addMonthNoOverflow()->subDay(),
            'merchant_reference' => 'SUB-'.Str::upper((string) Str::ulid()),
            'initiated_at' => Date::now(),
        ];
    }

    /** A charge Pesapal has already been told about. */
    public function submitted(string $trackingId): static
    {
        return $this->state(fn () => ['aggregator_tracking_id' => $trackingId]);
    }

    public function succeeded(): static
    {
        return $this->state(fn () => [
            'status' => SubscriptionChargeStatus::Succeeded,
            'aggregator_reference' => 'PESA-CONF-'.Str::upper(Str::random(6)),
            'resolved_at' => Date::now(),
        ]);
    }

    public function failed(): static
    {
        return $this->state(fn () => [
            'status' => SubscriptionChargeStatus::Failed,
            'failure_code' => 'insufficient_funds',
            'resolved_at' => Date::now(),
        ]);
    }
}
