<?php

namespace App\Services\Payments\Pesapal;

use App\Services\Payments\GatewayStatus;

/**
 * What Pesapal says became of a RECURRING subscription transaction.
 *
 * A GatewayStatus plus one extra fact, and the extra fact is the whole reason
 * this type exists: a recurring notification arrives carrying nothing but an
 * OrderTrackingId, for a transaction PESAPAL initiated, which this system has
 * never seen. Nothing in the notification says which clinic it is for, and
 * nothing in it could be believed if it did.
 *
 * `subscription_transaction_info.account_reference` in the GetTransactionStatus
 * response is what says. It is the `account_number` we set when the
 * subscription was created -- the tenant id -- echoed back by Pesapal over an
 * authenticated TLS connection. That is the only statement of which clinic paid
 * that this system will act on.
 *
 * Carried as its own type rather than as a raw response array so that the
 * decode-and-scrub discipline stays inside PesapalClient. A caller handed the
 * body would be a caller able to read a field the client deliberately does not
 * expose, and the first one to do it would read a status.
 *
 * @see docs/70-decisions/0012-pesapal-unsigned-ipn.md
 */
final readonly class PesapalSubscriptionStatus
{
    public function __construct(
        public GatewayStatus $status,

        /**
         * The `account_number` we set at subscription time, as Pesapal holds it.
         *
         * Null when Pesapal reports no subscription information -- which is the
         * ordinary answer for a one-off transaction, and a reason to act on
         * nothing rather than to guess a clinic.
         */
        public ?string $accountReference,
    ) {}
}
