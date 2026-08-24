<?php

namespace App\Services\Payments;

/**
 * Where to send the patient, and what the aggregator will call it.
 *
 * The whole of what a server-side initiation gives us back. Note what is NOT
 * here: no amount collected, no status, no confirmation, no reference to money
 * of any kind. An initiation is a handoff -- we have told the clinic's own
 * aggregator that a collection is expected, and the patient now deals with the
 * aggregator directly. Nothing has been paid at this point and nothing has
 * moved, least of all through us.
 *
 * A value object rather than an array for the same reason GatewayStatus is one:
 * an array of two strings invites a caller to reach for a third key that does
 * not exist, and to get null instead of an error when it does so.
 *
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 */
final readonly class CollectionHandoff
{
    private function __construct(
        /**
         * The AGGREGATOR'S identifier for this order, not ours.
         *
         * Stored against the intent because Pesapal's notification carries this
         * and nothing else -- see ADR-0012. It is opaque and we never parse it.
         */
        public string $trackingId,
        /** The aggregator's hosted payment page. The patient's browser goes here. */
        public string $redirectUrl,
    ) {}

    public static function to(string $trackingId, string $redirectUrl): self
    {
        return new self($trackingId, $redirectUrl);
    }
}
