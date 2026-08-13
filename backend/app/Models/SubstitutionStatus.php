<?php

namespace App\Models;

use App\Support\StateMachine\TransitsState;

/** @see docs/10-product/prd-h4-prescription-dispensing-delivery.md */
enum SubstitutionStatus: string
{
    use TransitsState;

    case Pending = 'pending';
    case Approved = 'approved';
    case Rejected = 'rejected';

    /** @return list<self> */
    public function allowedTransitions(): array
    {
        return match ($this) {
            // Only a clinician decides. Never the pharmacist who proposed it,
            // never the administrator, and there is no auto-approval: a
            // clinician who cannot be reached leaves the order holding.
            self::Pending => [self::Approved, self::Rejected],
            self::Approved, self::Rejected => [],
        };
    }
}
