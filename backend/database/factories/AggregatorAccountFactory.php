<?php

namespace Database\Factories;

use App\Models\AggregatorAccount;
use Illuminate\Database\Eloquent\Factories\Factory;
use Illuminate\Support\Str;

/**
 * A tenant's own credentials at a BoU-licensed aggregator.
 *
 * $model is declared explicitly because AggregatorAccount deliberately does not
 * use HasFactory: nothing in the application should be able to conjure a set of
 * merchant credentials from a model call. Tests reach for the factory by name.
 *
 * The values below are obvious sandbox placeholders. A factory that produced
 * something resembling a real key would eventually be pasted somewhere real.
 *
 * @extends Factory<AggregatorAccount>
 */
class AggregatorAccountFactory extends Factory
{
    /** @var class-string<AggregatorAccount> */
    protected $model = AggregatorAccount::class;

    /** @return array<string, mixed> */
    public function definition(): array
    {
        return [
            'provider' => 'flutterwave',
            'public_key' => 'FLWPUBK_TEST-'.Str::random(24),
            'secret_key' => 'FLWSECK_TEST-'.Str::random(24),
            'webhook_secret' => 'whsec_test_'.Str::random(32),
            'merchant_reference' => 'MERCH-'.Str::upper(Str::random(6)),
            'environment' => 'sandbox',
            'status' => 'active',
            'last_verified_at' => now(),
        ];
    }

    /**
     * A clinic that banks with Pesapal.
     *
     * The credential names differ from Flutterwave's in kind, not just in
     * value: Pesapal's consumer key lives in public_key and its consumer secret
     * in secret_key, and there is NO webhook secret at all -- Pesapal signs
     * nothing, which is the whole subject of ADR-0012. Leaving it null here is
     * a statement of that, not an omission.
     */
    public function pesapal(): static
    {
        return $this->state(fn (): array => [
            'provider' => 'pesapal',
            'public_key' => 'PESAPAL_TEST_CONSUMER_KEY_'.Str::random(16),
            'secret_key' => 'PESAPAL_TEST_CONSUMER_SECRET_'.Str::random(16),
            'webhook_secret' => null,
            'ipn_id' => null,
        ]);
    }

    /** A Pesapal account whose notification URL is already registered. */
    public function withIpnId(string $ipnId): static
    {
        return $this->state(fn (): array => ['ipn_id' => $ipnId]);
    }

    public function withWebhookSecret(string $secret): static
    {
        return $this->state(fn () => ['webhook_secret' => $secret]);
    }

    /**
     * Onboarding started and stopped. The webhook endpoint must answer 404 for
     * this account -- indistinguishable from a tenant that does not exist.
     */
    public function unconfigured(): static
    {
        return $this->state(fn () => [
            'status' => 'unconfigured',
            'secret_key' => null,
            'webhook_secret' => null,
        ]);
    }

    /** Credentials expired or revoked at the aggregator. */
    public function failing(): static
    {
        return $this->state(fn () => ['status' => 'failing']);
    }
}
