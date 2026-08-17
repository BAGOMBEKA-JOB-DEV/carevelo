<?php

namespace App\Support\Auth;

/**
 * Why a one-time code was accepted or refused.
 *
 * THIS DISTINCTION EXISTS FOR THE AUDIT TRAIL ONLY. The caller receives one
 * response for every refusal, because "that code expired" and "that code was
 * already used" together tell an attacker which of their guesses landed on a
 * real code, and "no code exists for this number" tells them whether the number
 * is registered at this clinic at all.
 *
 * The clinic, reading its own audit trail, needs the opposite: a replay is
 * somebody using a code they should not have, and an expiry is a patient who
 * was slow. One is an incident and the other is a Tuesday.
 *
 * @see docs/50-security-compliance/audit-logging.md
 */
enum OtpOutcome: string
{
    case Verified = 'verified';

    /** No code for this number matched what was submitted. */
    case Mismatch = 'mismatch';

    case Expired = 'expired';

    /** The code was right, and had already been spent. */
    case Replayed = 'replayed';

    /** The number is not registered at this clinic. */
    case UnknownIdentity = 'unknown_identity';
}
