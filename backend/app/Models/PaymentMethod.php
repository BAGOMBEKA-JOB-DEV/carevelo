<?php

namespace App\Models;

enum PaymentMethod: string
{
    case MtnMomo = 'mtn_momo';
    case AirtelMoney = 'airtel_money';
    case Card = 'card';

    /**
     * No aggregator involved. A staff member attests receipt, and the
     * attestation is itself an audited action -- the clinic's own internal
     * control, not ours.
     */
    case CashAtClinic = 'cash_at_clinic';

    public function requiresAggregator(): bool
    {
        return $this !== self::CashAtClinic;
    }

    /** Mobile money is genuinely asynchronous: a push, a PIN, and a wait. */
    public function isMobileMoney(): bool
    {
        return in_array($this, [self::MtnMomo, self::AirtelMoney], true);
    }
}
