<?php

namespace App\Http\Controllers\Webhooks;

use App\Http\Controllers\Controller;
use App\Http\Responses\ProblemDetails;
use App\Services\Billing\PlatformMerchant;
use App\Services\Billing\RecurringChargeResolver;
use App\Services\Billing\SubscriptionNotificationLedger;
use App\Services\Payments\AggregatorUnavailable;
use App\Services\Payments\Pesapal\PesapalClient;
use App\Tenancy\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Pesapal's notification about CAREVELO'S OWN subscription revenue.
 *
 * A third webhook controller, beside AggregatorWebhookController (Flutterwave,
 * signed) and PesapalIpnController (Pesapal, unsigned, per clinic). Three, not
 * one with branches, and this one is the least optional of the three: it is the
 * only endpoint in the system where the merchant is Carevelo. A shared handler
 * would put a clinic's collection and Carevelo's collection through one
 * function, one account lookup and one resolver, which is precisely the blending
 * ADR-0003 says would end the company.
 *
 * THE NOTIFICATION IS A HINT AND IS TRUSTED FOR NOTHING, exactly as ADR-0012
 * requires, and for one additional reason that does not apply next door. A
 * recurring transaction is initiated by PESAPAL, on the schedule it was given
 * months ago, so its `OrderTrackingId` is one this system has never seen and
 * cannot look anything up by. NOTHING in the notification says which clinic it
 * concerns. `OrderNotificationType: RECURRING` says only what kind of event it
 * is, and even that is not read here -- a field an anonymous caller chooses is
 * not a field worth branching on.
 *
 * The clinic is named by `subscription_transaction_info.account_reference` in
 * the GetTransactionStatus RESPONSE: the `account_number` we set when the
 * subscription was created, echoed back over an authenticated TLS connection by
 * the party that took the money.
 *
 * WHY THAT IS SAFE BY CONSTRUCTION rather than by care. Exactly one field is
 * read from the request -- the tracking id, taken in __invoke() -- and the
 * Request object is then DISCARDED: process() cannot accept it, so no later step
 * can reach back for a status, an amount, a clinic or a notification type that a
 * forger would love to supply. The most a forged notification achieves is to
 * make us ask Pesapal a question and receive Pesapal's honest answer.
 *
 * DO NOT "FIX" THIS BY TRUSTING THE BODY. Reading a status, an amount or an
 * account reference out of the notification would turn an unauthenticated public
 * endpoint into a way to extend any clinic's subscription for nothing. If a
 * future Pesapal version signs its notifications, verify the signature IN
 * ADDITION to the status call, never instead of it.
 *
 * @see docs/70-decisions/0012-pesapal-unsigned-ipn.md
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 */
class PlatformBillingIpnController extends Controller
{
    /**
     * Long enough for any GUID Pesapal mints, short enough that a probe cannot
     * push a megabyte into the idempotency ledger's unique index.
     */
    private const TRACKING_ID_MAX = 100;

    public function __construct(
        private readonly Tenancy $tenancy,
        private readonly PlatformMerchant $merchant,
        private readonly PesapalClient $client,
        private readonly SubscriptionNotificationLedger $ledger,
        private readonly RecurringChargeResolver $resolver,
    ) {}

    /**
     * Receive a Pesapal notification about a subscription transaction.
     *
     * Trusted for nothing. `OrderTrackingId` is the only field read, and it is
     * used solely as the `orderTrackingId` argument to an authenticated call to
     * Pesapal. Everything this endpoint acts on comes from that answer.
     *
     * Always answers `{"received": true}` with 200, or a neutral 404 that does
     * not distinguish an unconfigured platform from an unreadable request.
     */
    public function __invoke(Request $request): JsonResponse
    {
        // THE ONLY PLACE THE REQUEST IS TOUCHED. `input()` reads the query
        // string and the body alike, which is what the route's GET|POST needs:
        // Pesapal registers a notification type per URL and has been known to
        // send either.
        $trackingId = $request->input('OrderTrackingId');

        if (! is_string($trackingId) || $trackingId === '' || strlen($trackingId) > self::TRACKING_ID_MAX) {
            return $this->notFound();
        }

        // From here the Request no longer exists as far as this handler is
        // concerned. That is not tidiness; it is the property the docblock above
        // claims, expressed as a signature.
        return $this->process($trackingId);
    }

    private function process(string $trackingId): JsonResponse
    {
        // 1. Carevelo's own credentials, from configuration. There is no tenant
        //    in the path and there is nowhere for one to come from -- the
        //    merchant here is us, and the endpoint would be wrong if a clinic
        //    could name itself into it.
        $credentials = $this->merchant->credentials();

        if (! $credentials->isConfigured()) {
            // A neutral 404 on an unconfigured platform. The endpoint is public,
            // and an error that distinguishes "not set up" from "not found"
            // tells an anonymous caller about our deployment.
            Log::info('platform.billing_ipn_unconfigured');

            return $this->notFound();
        }

        // 2. Claim BEFORE the status call, which bounds what a replayed
        //    notification can cost: one outbound request per transaction rather
        //    than one per delivery. A duplicate is a 200 no-op.
        $deliveryId = $this->ledger->claim($trackingId);

        if ($deliveryId === null) {
            return $this->accepted();
        }

        // 3. THE ONLY SOURCE OF TRUTH. An authenticated read from Pesapal with
        //    the platform's own credentials. Nothing from the request reaches
        //    this call except the tracking id it was claimed under.
        try {
            $reported = $this->client->subscriptionStatusUsing($credentials, $trackingId);
        } catch (AggregatorUnavailable $e) {
            // Answer 200 anyway. Pesapal retrying will not make Pesapal
            // reachable, and an error status invites it to hammer a public
            // endpoint. The delivery stays recorded as `received`, which is the
            // honest description -- we heard, and could not read.
            Log::warning('platform.billing_ipn_status_unavailable', [
                // The provider's own words about reachability, and no credential:
                // PesapalClient constructs these messages and never puts one in
                // them.
                'reason' => $e->getMessage(),
            ]);

            return $this->accepted();
        }

        // 4. Apply. The resolver reads the payer from Pesapal's answer, enforces
        //    the amount boundary against what the clinic's register row says it
        //    agreed to pay, and extends the paid-through date only on an actual
        //    transition into `succeeded`.
        //
        //    ASSERTED, NOT ASSUMED, that no tenant is bound. The route drops
        //    ResolveTenant and BindTenantContext, so this holds today; if a
        //    future middleware change ever bound one, every read and write below
        //    would silently return nothing under the table's policy, and a
        //    silently-successful no-op is the worst failure available to a
        //    billing endpoint.
        if ($this->tenancy->has()) {
            Log::error('platform.billing_ipn_tenant_bound');

            return $this->notFound();
        }

        $outcome = $this->resolver->apply($trackingId, $reported);

        $this->ledger->recordOutcome($deliveryId, $outcome);

        // Nothing from the notification is stored. There is nothing in it worth
        // keeping: no status, no amount, no clinic, no signature.
        return $this->accepted();
    }

    /**
     * The only success body this endpoint ever returns.
     *
     * No internal detail, no charge id, no clinic, no state. The endpoint is
     * public and its responses are an information-disclosure surface.
     */
    private function accepted(): JsonResponse
    {
        return new JsonResponse(['received' => true], 200);
    }

    private function notFound(): JsonResponse
    {
        return ProblemDetails::make(404, 'not_found', 'Not found');
    }
}
