<?php

namespace App\Models;

use App\Support\StateMachine\TransitsState;

/**
 * What became of one attempt to collect a clinic's subscription fee.
 *
 * Deliberately NOT PaymentIntentStatus, though it is a near-twin of it. Reusing
 * that enum would be the first step towards reusing the resolver, then the
 * account lookup, then the table -- and one code path for a patient's payment to
 * a clinic and a clinic's payment to Carevelo is exactly how custody arrives by
 * accident. The duplication is the control.
 *
 * The differences are real, not cosmetic. There is no `initiated -> pending`
 * step here, because nobody is standing at a counter watching a mobile-money
 * prompt: a subscription charge is a recurring instruction Pesapal executes on
 * its own schedule, and the first this system hears of one is the answer.
 *
 * @see docs/20-domain/state-machines.md
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 */
enum SubscriptionChargeStatus: string
{
    use TransitsState;

    /**
     * Recorded, and not yet answered for.
     *
     * Either we submitted the order and Pesapal has not reported, or a recurring
     * transaction arrived and the row was written a moment before the status was
     * read. Both are momentary; nothing waits in this state for long.
     */
    case Initiated = 'initiated';

    case Succeeded = 'succeeded';

    case Failed = 'failed';

    /** Rare, and always human-handled once recorded. */
    case Reversed = 'reversed';

    /** @return list<self> */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::Initiated => [self::Succeeded, self::Failed],
            // A collection Pesapal later reverses. The clinic's paid-through
            // date is NOT wound back here: withdrawing service retroactively
            // over a payments dispute is a decision for a person, and the sweep
            // that suspends is deliberately not that person.
            self::Succeeded => [self::Reversed],
            // A failed charge is final AS A CHARGE. The retry is Pesapal's
            // recurring schedule, which produces a NEW transaction with a new
            // tracking id and therefore a new row -- so nothing is served by
            // letting this one change its mind.
            self::Failed, self::Reversed => [],
        };
    }

    public function isResolved(): bool
    {
        return $this !== self::Initiated;
    }
}
