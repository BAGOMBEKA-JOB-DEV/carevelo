<?php

namespace App\Services\Payments;

use App\Models\AggregatorAccount;
use App\Models\PaymentIntent;
use App\Services\Payments\Pesapal\PesapalGateway;
use Illuminate\Contracts\Container\Container;

/**
 * Picks the client for the account being used, and no other.
 *
 * `#[Bind(FlutterwaveGateway::class)]` on the port was correct while one
 * provider existed. With two it would be a defect of exactly the kind this
 * system is built to make impossible: a clinic that banks with Pesapal would
 * have its collections read by Flutterwave's client, using Pesapal
 * credentials, against Flutterwave's API -- and would see an unreachable
 * aggregator rather than the truth.
 *
 * So the container resolves the port to THIS, and the provider on the account
 * chooses the client. The choice is made per call from the credential being
 * used, which is the only fact that can possibly be authoritative about which
 * aggregator holds the money. Nothing here is configurable, cached or
 * defaulted: an unknown provider is refused rather than approximated.
 *
 * It implements the port it dispatches to, so no caller has to know this class
 * exists, and so a test can still substitute a fake for the whole port with one
 * `app()->instance()` call.
 *
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 */
final class AggregatorGateways implements PaymentGateway
{
    /**
     * The providers a client actually exists for.
     *
     * The API's accepted provider list is derived from this, so "we accept it"
     * and "we can talk to it" cannot drift apart -- which they did while
     * Pesapal was accepted at onboarding and refused at verification.
     *
     * @var list<string>
     */
    public const PROVIDERS = ['flutterwave', 'pesapal'];

    public function __construct(private readonly Container $container) {}

    public function fetchStatus(AggregatorAccount $account, PaymentIntent $intent): GatewayStatus
    {
        return $this->clientFor($account->provider)->fetchStatus($account, $intent);
    }

    public function initiateCollection(AggregatorAccount $account, PaymentIntent $intent): CollectionHandoff
    {
        return $this->clientFor($account->provider)->initiateCollection($account, $intent);
    }

    /**
     * The real client for a provider.
     *
     * Public so a guard test can assert, per provider, that the container hands
     * back the real thing and never a fake. The fake is bound only by a test
     * that asks for it; if it were ever the default, every payment in
     * production would sit unresolved for ever while looking perfectly healthy.
     *
     * @throws AggregatorUnavailable for a provider with no client
     */
    public function clientFor(string $provider): PaymentGateway
    {
        return match ($provider) {
            'flutterwave' => $this->container->make(FlutterwaveGateway::class),
            'pesapal' => $this->container->make(PesapalGateway::class),
            // Named, not echoed blindly: the provider comes off a row we wrote,
            // never off a request, so there is nothing here to escape.
            default => throw new AggregatorUnavailable("No client is implemented for provider [{$provider}]."),
        };
    }
}
