<?php

namespace App\Services\Payments;

use App\Models\AggregatorAccount;

/**
 * Finds the current tenant's own aggregator account.
 *
 * Deliberately has no way to name a tenant: the account it returns is whichever
 * one row-level security allows the caller to see, which is the calling
 * tenant's and no other. Cross-tenant credential use is therefore not a rule to
 * remember but a query that cannot be written.
 *
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 */
final class AggregatorAccounts
{
    public function forProvider(string $provider): ?AggregatorAccount
    {
        return AggregatorAccount::query()->where('provider', $provider)->first();
    }

    /**
     * The tenant's webhook secret, if one is configured.
     *
     * Returned only to be fed straight into a constant-time comparison. It is
     * never logged, never rendered, and never placed in a response -- including
     * an error response, which is where a secret most often escapes.
     */
    public function webhookSecret(AggregatorAccount $account): ?string
    {
        $secret = $account->webhook_secret;

        return is_string($secret) && $secret !== '' ? $secret : null;
    }
}
