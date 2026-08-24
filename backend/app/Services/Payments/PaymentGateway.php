<?php

namespace App\Services\Payments;

use App\Models\AggregatorAccount;
use App\Models\PaymentIntent;
use Illuminate\Container\Attributes\Bind;

/**
 * What a BoU-licensed aggregator can be asked to do on a clinic's behalf.
 *
 * The account is a parameter rather than a constructor dependency on purpose.
 * Every call must use THAT TENANT'S OWN credentials, and there is no
 * platform-level merchant account to fall back on -- so the credential is
 * pushed into the signature where a caller cannot forget it, and an
 * implementation cannot quietly acquire a default.
 *
 * NEITHER METHOD MOVES MONEY. fetchStatus() is a read. initiateCollection()
 * tells the clinic's own aggregator that a collection is expected and hands
 * back the page the patient pays on -- the patient then pays the aggregator,
 * and the aggregator settles to the clinic direct. Carevelo is never a party to
 * the transfer, holds nothing at any point, and could not intercept it if it
 * wanted to: the merchant account is the clinic's.
 *
 * Two providers are implemented and they work in opposite directions.
 * Flutterwave is initiated client-side and read back by us; Pesapal is
 * initiated by us and read back by us. The binding below is therefore a
 * RESOLVER keyed on the account's provider, not a single implementation: with
 * one provider a default was harmless, with two it would silently send one
 * clinic's collection through another clinic's aggregator's client.
 *
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 */
#[Bind(AggregatorGateways::class)]
interface PaymentGateway
{
    /**
     * @throws AggregatorUnavailable when the aggregator cannot be reached or
     *                               answered with something unreadable
     */
    public function fetchStatus(AggregatorAccount $account, PaymentIntent $intent): GatewayStatus;

    /**
     * Tell the clinic's own aggregator that a collection is expected.
     *
     * Returns the handoff -- the aggregator's tracking id and the page the
     * patient pays on -- and nothing else, because nothing else has happened.
     * No funds exist yet, and when they do they will not pass through here.
     *
     * Persisting the handoff is the CALLER'S job, deliberately. An adapter that
     * wrote to the intent would be doing domain work behind a port, and the
     * fake used in tests would then have to fake a database write to be
     * faithful -- which is how a fake stops proving anything.
     *
     * @throws AggregatorUnavailable when the aggregator cannot be reached,
     *                               answered with something unreadable, or does
     *                               not offer server-side initiation at all
     */
    public function initiateCollection(AggregatorAccount $account, PaymentIntent $intent): CollectionHandoff;
}
