<?php

namespace App\Models;

use App\Support\StateMachine\TransitsState;

/** @see docs/20-domain/state-machines.md */
enum DispenseOrderStatus: string
{
    use TransitsState;

    case Received = 'received';
    case UnderReview = 'under_review';
    case AwaitingSubstitution = 'awaiting_substitution';
    case Priced = 'priced';
    case PartiallyPriced = 'partially_priced';
    case AwaitingPayment = 'awaiting_payment';
    case Paid = 'paid';
    case Dispensed = 'dispensed';
    case ReadyForPickup = 'ready_for_pickup';
    case OutForDelivery = 'out_for_delivery';
    case Collected = 'collected';
    case Completed = 'completed';
    case Returned = 'returned';
    case RefundPending = 'refund_pending';
    case Cancelled = 'cancelled';
    case Rejected = 'rejected';

    /** @return list<self> */
    public function allowedTransitions(): array
    {
        return match ($this) {
            self::Received => [self::UnderReview],
            self::UnderReview => [self::AwaitingSubstitution, self::Priced, self::Rejected],
            // awaiting_substitution blocks only the affected item; the rest of
            // the order proceeds. One out-of-stock item must not stall
            // everything, or pharmacists work around the system.
            self::AwaitingSubstitution => [self::Priced, self::PartiallyPriced, self::Rejected],
            self::Priced, self::PartiallyPriced => [self::AwaitingPayment],
            self::AwaitingPayment => [self::Paid, self::Cancelled],
            self::Paid => [self::Dispensed],
            self::Dispensed => [self::ReadyForPickup, self::OutForDelivery],
            self::ReadyForPickup => [self::Collected],
            self::OutForDelivery => [self::Completed, self::Returned],
            // refund_pending makes the obligation VISIBLE; it does not
            // discharge it. Carevelo holds nothing to refund from -- the
            // clinic refunds through its own aggregator.
            self::Returned => [self::OutForDelivery, self::RefundPending],
            self::Collected, self::Completed, self::Cancelled,
            self::Rejected, self::RefundPending => [],
        };
    }
}
