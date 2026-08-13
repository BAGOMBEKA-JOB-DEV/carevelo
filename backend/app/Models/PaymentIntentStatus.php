<?php

namespace App\Models;

use App\Support\StateMachine\TransitsState;

/**
 * @see docs/20-domain/state-machines.md
 * @see docs/10-product/prd-h5-payments-non-custodial.md
 */
enum PaymentIntentStatus: string
{
    use TransitsState;

    case Initiated = 'initiated';

    /**
     * The NORMAL state for mobile money, not an edge case.
     *
     * The patient has to pick up their handset and enter a PIN, and they may
     * not. The UI must be honest about waiting rather than pretending to be
     * instant.
     */
    case Pending = 'pending';

    case Succeeded = 'succeeded';
    case Failed = 'failed';
    case TimedOut = 'timed_out';
    case Reversed = 'reversed';

    /** @return list<self> */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::Initiated => [self::Pending, self::Failed],
            self::Pending => [self::Succeeded, self::Failed, self::TimedOut],
            // timed_out is NOT final. Mobile-money confirmations arrive late,
            // and a reconciliation poll can still move it to succeeded.
            // Treating a timeout as definitive failure produces the worst
            // outcome available: a patient charged for a cancelled booking.
            self::TimedOut => [self::Succeeded, self::Failed, self::Pending],
            self::Succeeded => [self::Reversed],
            self::Failed, self::Reversed => [],
        };
    }

    public function isResolved(): bool
    {
        return in_array($this, [self::Succeeded, self::Failed, self::Reversed], true);
    }
}
