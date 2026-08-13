<?php

namespace App\Models;

use App\Support\StateMachine\TransitsState;

/** @see docs/20-domain/state-machines.md */
enum AppointmentStatus: string
{
    use TransitsState;

    case AwaitingPayment = 'awaiting_payment';
    case PaymentFailed = 'payment_failed';
    case Confirmed = 'confirmed';
    case InProgress = 'in_progress';
    case Completed = 'completed';
    case Cancelled = 'cancelled';
    case NoShow = 'no_show';
    case Expired = 'expired';
    case Abandoned = 'abandoned';

    /** @return list<self> */
    public function allowedTransitions(): array
    {
        return match ($this) {
            // Expired and cancelled differ: expiry is the system releasing an
            // unpaid slot, cancellation is a human decision. The clinic owner
            // reads these differently and so should we.
            self::AwaitingPayment => [self::Confirmed, self::PaymentFailed, self::Cancelled, self::Expired],
            self::PaymentFailed => [self::AwaitingPayment, self::Cancelled],
            self::Confirmed => [self::InProgress, self::Cancelled, self::NoShow],
            self::InProgress => [self::Completed, self::Abandoned],
            self::Completed, self::Cancelled, self::NoShow,
            self::Expired, self::Abandoned => [],
        };
    }
}
