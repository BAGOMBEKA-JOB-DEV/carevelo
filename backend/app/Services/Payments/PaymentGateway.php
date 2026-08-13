<?php

namespace App\Services\Payments;

use App\Models\AggregatorAccount;
use App\Models\PaymentIntent;
use Illuminate\Container\Attributes\Bind;

/**
 * Asks an aggregator what became of a collection.
 *
 * The account is a parameter rather than a constructor dependency on purpose.
 * Every call must use THAT TENANT'S OWN credentials, and there is no
 * platform-level merchant account to fall back on -- so the credential is
 * pushed into the signature where a caller cannot forget it, and an
 * implementation cannot quietly acquire a default.
 *
 * This is a read. Nothing here initiates or moves money: the patient pays the
 * aggregator and the aggregator pays the clinic directly.
 *
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 */
#[Bind(FlutterwaveGateway::class)]
interface PaymentGateway
{
    /**
     * @throws AggregatorUnavailable when the aggregator cannot be reached or
     *                               answered with something unreadable
     */
    public function fetchStatus(AggregatorAccount $account, PaymentIntent $intent): GatewayStatus;
}
