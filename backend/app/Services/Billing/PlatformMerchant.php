<?php

namespace App\Services\Billing;

use App\Services\Payments\Pesapal\PesapalCredentials;

/**
 * Carevelo's own merchant account, and the only one that exists.
 *
 * THE ENTIRE POINT OF THIS CLASS IS WHAT IT CANNOT DO. It reads config/billing.php
 * and nothing else. There is no method taking a tenant, no fallback to an
 * AggregatorAccount, and no way to reach one from here -- so a subscription
 * collection cannot be made against a clinic's merchant account even by a caller
 * that wanted to, and a patient's payment cannot be made against this one.
 *
 * That asymmetry is the compliance boundary rendered as a type. ADR-0003 allows
 * Carevelo to be the merchant for its OWN subscription revenue and for nothing
 * else -- "Revenue is subscription-only (SS-F)" -- and the way a design drifts
 * across that line is not a decision, it is a shared lookup that one day returns
 * the wrong account.
 *
 * UNCONFIGURED IS A FIRST-CLASS STATE, not an error to defer. A developer
 * machine, CI and every test run have no platform Pesapal credentials, and the
 * suspension sweep and the notification endpoint both have to behave sanely
 * there. `isConfigured()` is how callers ask, and the answer being false must
 * always mean "collect nothing", never "collect through something else".
 *
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 */
final class PlatformMerchant
{
    public function isConfigured(): bool
    {
        return $this->credentials()->isConfigured();
    }

    /**
     * The credentials, built fresh each time.
     *
     * Not memoised. These are read from configuration, which is cheap, and a
     * cached credential object is a credential living longer than it needs to in
     * a long-running worker's memory.
     */
    public function credentials(): PesapalCredentials
    {
        return PesapalCredentials::forPlatform([
            'consumer_key' => $this->string('consumer_key'),
            'consumer_secret' => $this->string('consumer_secret'),
            'environment' => $this->string('environment'),
        ]);
    }

    /**
     * Pesapal's registered id for the platform notification URL.
     *
     * Configured rather than registered lazily. RegisterIPN is not idempotent,
     * and unlike the per-clinic case there is exactly ONE platform account: a
     * lazy registration would run on whichever deployment happened to bill
     * first, and a second registration means two notifications per transaction
     * for ever.
     *
     * Null when unset, which SubscriptionBilling refuses on rather than
     * substituting a clinic's.
     */
    public function notificationId(): ?string
    {
        return $this->string('ipn_id');
    }

    /**
     * How long after a period ends before staff sign-in is blocked.
     *
     * Read here rather than in the sweep so that the number and the merchant it
     * belongs to stay in one file. Clamped at zero: a negative grace period
     * would suspend clinics before their period had ended, which is the kind of
     * configuration error that should be inert rather than catastrophic.
     */
    public function graceDays(): int
    {
        $configured = config('billing.grace_days');

        return max(0, is_numeric($configured) ? (int) $configured : 0);
    }

    private function string(string $key): ?string
    {
        $value = config('billing.pesapal.'.$key);

        return is_string($value) && $value !== '' ? $value : null;
    }
}
