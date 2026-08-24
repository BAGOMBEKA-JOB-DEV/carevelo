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
     * The clinic's aggregator account, whatever state it is in.
     *
     * A clinic banks with ONE aggregator; the table permits a row per provider
     * only so a clinic can move between them without losing its history. Which
     * one is therefore a fact about the clinic, never a platform preference --
     * there is no platform account to prefer.
     *
     * Returned regardless of status, because "which aggregator is this clinic
     * with" is a different question from "may we collect through it today", and
     * the caller answers the second with isUsable(). Conflating them would
     * record a payment attempt against no aggregator at all merely because a
     * key was awaiting verification, and reconciliation would then have nothing
     * to ask.
     *
     * Null is a WORKING STATE, not an error: a clinic with no account keeps
     * seeing patients on pay-at-clinic. Nothing in the payment path may block
     * care.
     */
    public function current(): ?AggregatorAccount
    {
        return AggregatorAccount::query()->first();
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
