<?php

namespace App\Services\Payments;

/**
 * What happened to a reported outcome once we looked at it.
 *
 * Stored on the webhook delivery record so a support conversation can
 * distinguish "we never heard from the aggregator" from "we heard, and refused
 * what it said" -- which are completely different problems with completely
 * different owners.
 */
enum ResolutionOutcome: string
{
    /** Claimed for processing. Overwritten before the response is sent. */
    case Received = 'received';

    case Applied = 'applied';

    /** The intent was already in the reported state. Idempotent by design. */
    case NoChange = 'no_change';

    /** Retrying will not conjure the intent into existence. */
    case UnknownReference = 'unknown_reference';

    /**
     * The fraud boundary fired. Flagged for the administrator, and NEVER
     * auto-accepted: a forged or replayed payload must not confirm a large
     * booking against a small payment.
     */
    case AmountMismatch = 'amount_mismatch';

    /** Reported an outcome the intent cannot legally reach. Needs a human. */
    case IllegalTransition = 'illegal_transition';

    public function isFlagged(): bool
    {
        return $this === self::AmountMismatch || $this === self::IllegalTransition;
    }
}
