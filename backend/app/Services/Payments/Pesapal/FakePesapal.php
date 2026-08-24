<?php

namespace App\Services\Payments\Pesapal;

use App\Models\AggregatorAccount;
use App\Models\PaymentIntent;
use App\Services\Payments\AggregatorUnavailable;
use App\Services\Payments\CollectionHandoff;
use App\Services\Payments\GatewayStatus;
use App\Services\Payments\PaymentGateway;

/**
 * A programmable Pesapal, for tests.
 *
 * The established substitution point in this repository is the PORT, not the
 * HTTP client -- a test binds this into the container and the real
 * PesapalGateway is never constructed. That is what lets a test about domain
 * behaviour say what it means: "when Pesapal reports code 2, the intent fails",
 * with no fixture JSON in the way. PesapalClient's own tests use Http::fake,
 * because there the wire IS the subject.
 *
 * It records which AggregatorAccount every call was made with, exactly as
 * FakeGateway does, so a test can assert the thing that actually matters about
 * this integration: THE CLINIC'S OWN CREDENTIALS WERE USED, and never another
 * tenant's. That is a regulatory claim rather than a detail -- ADR-0003 turns
 * on it -- and an assertion is the only form of it that cannot rot.
 *
 * Lives in app/ rather than tests/ for the same reason FakeGateway does: the
 * container binds it, and a local sandbox run wants it too.
 */
final class FakePesapal implements PaymentGateway
{
    /** @var array<string, GatewayStatus> keyed by payment intent id */
    private array $programmed = [];

    private GatewayStatus $fallback;

    /**
     * Account ids in call order, across BOTH methods.
     *
     * The assertion surface for "the tenant's own credentials".
     *
     * @var list<string>
     */
    public array $accountsUsed = [];

    /** @var list<string> */
    public array $intentsPolled = [];

    /**
     * Intent ids an order was submitted for, in call order.
     *
     * @var list<string>
     */
    public array $ordersSubmitted = [];

    private ?AggregatorUnavailable $failure = null;

    private string $trackingId = 'PESAPAL-TRACK-0001';

    private string $redirectUrl = 'https://cybqa.pesapal.com/pesapaliframe/PesapalIframe3/Index?OrderTrackingId=PESAPAL-TRACK-0001';

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

    public function willHandOff(string $trackingId, ?string $redirectUrl = null): self
    {
        $this->trackingId = $trackingId;
        $this->redirectUrl = $redirectUrl
            ?? 'https://cybqa.pesapal.com/pesapaliframe/PesapalIframe3/Index?OrderTrackingId='.$trackingId;

        return $this;
    }

    /** Simulates an aggregator outage, which must never spin the queue. */
    public function willFail(string $message = 'Could not reach the aggregator.'): self
    {
        $this->failure = new AggregatorUnavailable($message);

        return $this;
    }

    public function initiateCollection(AggregatorAccount $account, PaymentIntent $intent): CollectionHandoff
    {
        $this->accountsUsed[] = $account->id;
        $this->ordersSubmitted[] = $intent->id;

        if ($this->failure !== null) {
            throw $this->failure;
        }

        return CollectionHandoff::to($this->trackingId, $this->redirectUrl);
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
