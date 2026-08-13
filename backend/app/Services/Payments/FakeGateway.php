<?php

namespace App\Services\Payments;

use App\Models\AggregatorAccount;
use App\Models\PaymentIntent;

/**
 * A programmable aggregator, for tests.
 *
 * It records which AggregatorAccount each call was made with, so a test can
 * assert the thing that actually matters about this integration: that the
 * clinic's OWN credentials were used, and never some other tenant's.
 *
 * Lives in app/ rather than tests/ because the container binds it, and because
 * a local sandbox run wants it too.
 */
final class FakeGateway implements PaymentGateway
{
    /** @var array<string, GatewayStatus> keyed by payment intent id */
    private array $programmed = [];

    private GatewayStatus $fallback;

    /**
     * Account ids in call order. The assertion surface for "the tenant's own
     * credentials", which is a regulatory claim rather than a detail.
     *
     * @var list<string>
     */
    public array $accountsUsed = [];

    /** @var list<string> */
    public array $intentsPolled = [];

    private ?AggregatorUnavailable $failure = null;

    public function __construct()
    {
        $this->fallback = GatewayStatus::pending();
    }

    public function will(PaymentIntent $intent, GatewayStatus $status): self
    {
        $this->programmed[$intent->id] = $status;

        return $this;
    }

    public function willAlways(GatewayStatus $status): self
    {
        $this->fallback = $status;

        return $this;
    }

    /** Simulates an aggregator outage, which must never spin the queue. */
    public function willFail(string $message = 'Could not reach the aggregator.'): self
    {
        $this->failure = new AggregatorUnavailable($message);

        return $this;
    }

    public function fetchStatus(AggregatorAccount $account, PaymentIntent $intent): GatewayStatus
    {
        $this->accountsUsed[] = $account->id;
        $this->intentsPolled[] = $intent->id;

        if ($this->failure !== null) {
            throw $this->failure;
        }

        return $this->programmed[$intent->id] ?? $this->fallback;
    }
}
