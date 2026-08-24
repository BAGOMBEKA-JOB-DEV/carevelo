<?php

namespace App\Support\Totp;

/**
 * What happened when a code was checked.
 *
 * A closed set rather than a boolean, because the four failures are genuinely
 * different to the AUDIT TRAIL even though three of them are the same sentence to
 * the person who typed the code. An operator seeing "that code is not right" must
 * not be able to tell a wrong code from a replayed one -- that distinction tells
 * an attacker whether they have a real code in the wrong window -- while a
 * reviewer reading the platform trail very much needs to know that a code was
 * REPLAYED, because a replay is somebody using a code they observed rather than
 * one they generated.
 *
 * These names therefore reach the audit metadata and never the response body.
 */
enum ChallengeOutcome: string
{
    /** The code matched a step inside the skew window that has not been spent. */
    case Accepted = 'accepted';

    /** A recovery code was spent instead. Rarer, more serious, always audited. */
    case AcceptedByRecoveryCode = 'accepted_by_recovery_code';

    /**
     * The code was arithmetically correct for a step at or before the last one
     * accepted. Somebody is replaying, or two tabs raced. Both are refusals.
     */
    case Replayed = 'replayed';

    /** Wrong code, or a code from outside the ninety-second window. */
    case Rejected = 'rejected';

    /** No confirmed secret on the account, so there is nothing to check against. */
    case NotEnrolled = 'not_enrolled';

    public function isAccepted(): bool
    {
        return $this === self::Accepted || $this === self::AcceptedByRecoveryCode;
    }
}
