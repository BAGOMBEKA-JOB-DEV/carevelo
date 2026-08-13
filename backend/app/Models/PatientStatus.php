<?php

namespace App\Models;

use App\Support\StateMachine\TransitsState;

/**
 * @see docs/20-domain/state-machines.md
 */
enum PatientStatus: string
{
    use TransitsState;

    case PendingConsent = 'pending_consent';
    case Active = 'active';
    case Withdrawn = 'withdrawn';
    case Discarded = 'discarded';

    /**
     * @return list<self>
     */
    public function allowedTransitions(): array
    {
        return match ($this) {
            // Declining consent ends registration. Only the minimal contact
            // detail needed to explain why service cannot proceed is retained,
            // and it is purged on schedule. No clinical footprint.
            self::PendingConsent => [self::Active, self::Discarded],
            self::Active => [self::Withdrawn],
            // Withdrawal halts new processing. It does not erase records the
            // clinic is obliged to retain as a medical record.
            self::Withdrawn => [self::Active],
            self::Discarded => [],
        };
    }
}
