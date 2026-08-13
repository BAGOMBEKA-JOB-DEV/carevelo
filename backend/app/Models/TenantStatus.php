<?php

namespace App\Models;

use App\Support\StateMachine\TransitsState;

/**
 * @see docs/20-domain/state-machines.md
 */
enum TenantStatus: string
{
    use TransitsState;

    case Provisioning = 'provisioning';
    case Active = 'active';
    case Suspended = 'suspended';
    case Offboarding = 'offboarding';
    case Closed = 'closed';

    /**
     * @return list<self>
     */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::Provisioning => [self::Active],
            // Suspension is a commercial action and must never become a
            // clinical one: it blocks staff sign-in, but never a patient
            // reading their own records or a delivery already in flight.
            self::Active => [self::Suspended, self::Offboarding],
            self::Suspended => [self::Active, self::Offboarding],
            self::Offboarding => [self::Closed],
            self::Closed => [],
        };
    }
}
