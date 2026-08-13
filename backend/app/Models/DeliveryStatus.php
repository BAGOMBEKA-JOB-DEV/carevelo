<?php

namespace App\Models;

use App\Support\StateMachine\TransitsState;

/** @see docs/20-domain/state-machines.md */
enum DeliveryStatus: string
{
    use TransitsState;

    case Unassigned = 'unassigned';
    case Assigned = 'assigned';
    case PickedUp = 'picked_up';
    case EnRoute = 'en_route';
    case Delivered = 'delivered';
    case Failed = 'failed';
    case ReturnedToPharmacy = 'returned_to_pharmacy';

    /** @return list<self> */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::Unassigned => [self::Assigned],
            self::Assigned => [self::PickedUp, self::Unassigned],
            self::PickedUp => [self::EnRoute],
            self::EnRoute => [self::Delivered, self::Failed],
            // Medicine returns to the licensed premises. It never sits with a
            // rider overnight, and a failed delivery never silently closes.
            self::Failed => [self::ReturnedToPharmacy],
            self::ReturnedToPharmacy => [self::Unassigned],
            self::Delivered => [],
        };
    }
}
