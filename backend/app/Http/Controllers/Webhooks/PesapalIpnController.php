<?php

namespace App\Http\Controllers\Webhooks;

use App\Http\Controllers\Controller;
use App\Http\Responses\ProblemDetails;
use App\Models\PaymentIntent;
use App\Models\Tenant;
use App\Services\Payments\AggregatorAccounts;
use App\Services\Payments\AggregatorUnavailable;
use App\Services\Payments\PaymentGateway;
use App\Services\Payments\PaymentIntentResolver;
use App\Services\Payments\WebhookDeliveryLedger;
use App\Tenancy\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Pesapal's Instant Payment Notification.
 *
 * THIS IS A HINT, NEVER A SOURCE OF TRUTH, and the distinction is the entire
 * design. It looks like the Flutterwave webhook next door and shares none of
 * its security model, so it is a separate controller rather than a branch
 * inside that one -- a shared handler with a `if ($provider === 'pesapal')`
 * would sooner or later have Pesapal's rules applied to a signed callback, or
 * the reverse.
 *
 * WHAT PESAPAL SENDS: `OrderTrackingId`, `OrderMerchantReference` and
 * `OrderNotificationType`. No status. No amount. NO SIGNATURE, and no shared
 * secret with which to compute one. Pesapal does this deliberately: the
 * notification exists to tell you that something happened, and you are required
 * to call GetTransactionStatus yourself to find out what.
 *
 * WHY THAT IS SAFE HERE, AND WHY IT IS SAFE BY CONSTRUCTION rather than by
 * care. Exactly one field is read from the request -- the tracking id, taken in
 * __invoke() -- and the Request object is then DISCARDED: process() cannot
 * accept it, so no later step can reach back for a status, an amount or a
 * tenant hint that a forger would love to supply. The tracking id is used for
 * two things and no others: as a lookup key inside one tenant's row-level
 * security context, and as the `orderTrackingId` argument to an authenticated
 * TLS call to Pesapal made with the CLINIC'S OWN credentials. Every fact that
 * reaches the resolver comes from that call.
 *
 * So the most a forged notification can achieve is to make us ask Pesapal a
 * question we were going to ask anyway on the reconciliation schedule, and to
 * receive Pesapal's honest answer. It cannot assert a payment, cannot assert an
 * amount, and cannot reach an intent belonging to another clinic.
 *
 * DO NOT "FIX" THIS BY TRUSTING THE BODY. Reading a status or an amount out of
 * the notification -- to save a round trip, to handle a provider that "sends it
 * anyway" -- turns an unauthenticated public endpoint into a way to confirm any
 * booking for free. If a future Pesapal version signs its notifications, verify
 * the signature IN ADDITION to the status call, never instead of it.
 *
 * @see docs/70-decisions/0012-pesapal-unsigned-ipn.md
 * @see docs/40-api/webhooks.md
 */
class PesapalIpnController extends Controller
{
    private const PROVIDER = 'pesapal';

    /**
     * Long enough for any GUID Pesapal mints, short enough that a probe cannot
     * push a megabyte into the idempotency ledger's unique index.
     */
    private const TRACKING_ID_MAX = 100;

    public function __construct(
        private readonly Tenancy $tenancy,
        private readonly AggregatorAccounts $accounts,
        private readonly WebhookDeliveryLedger $ledger,
        private readonly PaymentIntentResolver $resolver,
        private readonly PaymentGateway $gateway,
    ) {}

    /**
     * Receive a Pesapal instant payment notification.
     *
     * Trusted for nothing. `OrderTrackingId` is the only field read, and it is
     * used solely to look up an attempt within the named tenant and to ask
     * Pesapal, over TLS with the clinic's own credentials, what became of it.
     * Everything this endpoint acts on comes from that answer.
     *
     * Always answers `{"received": true}` with 200, or a neutral 404 that does
     * not distinguish an unknown tenant from an unconfigured clinic from an
     * unknown tracking id.
     *
     * See docs/70-decisions/0012-pesapal-unsigned-ipn.md
     */
    public function __invoke(Request $request, string $tenant): JsonResponse
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
        // concerned. That is not tidiness; it is the property the docblock
        // above claims, expressed as a signature.
        return $this->process($trackingId, $tenant);
    }

    private function process(string $trackingId, string $tenant): JsonResponse
    {
        // 1. Resolve the tenant named in the path. Untrusted: it locates a
        //    clinic, it does not authenticate anybody. A neutral 404 -- the
        //    endpoint is public, and confirming which clinics use Carevelo is
        //    itself a disclosure.
        $resolved = Tenant::query()->find($tenant)
            ?? Tenant::query()->where('slug', $tenant)->first();

        if ($resolved === null) {
            Log::info('payment.ipn_unknown_tenant', ['provider' => self::PROVIDER]);

            return $this->notFound();
        }

        return $this->tenancy->run(
            $resolved->id,
            fn (): JsonResponse => $this->processForTenant($trackingId, $resolved->id),
        );
    }

    private function processForTenant(string $trackingId, string $tenantId): JsonResponse
    {
        // 2. The clinic's own Pesapal credentials. Unconfigured is a 404,
        //    indistinguishable from an unknown tenant and from an unknown
        //    tracking id below -- a caller probing this endpoint learns the
        //    same nothing whichever of the three it hit.
        $account = $this->accounts->forProvider(self::PROVIDER);

        if ($account === null || ! $account->isUsable()) {
            Log::info('payment.ipn_unconfigured', ['provider' => self::PROVIDER, 'tenant_id' => $tenantId]);

            return $this->notFound();
        }

        // 3. Resolve the attempt. Scoped by row-level security to THIS tenant,
        //    so a tracking id belonging to another clinic is simply not there.
        //    404 rather than the neighbour's 200: a Pesapal tracking id is
        //    minted by Pesapal, so an unknown one is not a stray callback from
        //    another environment -- it is a guess, and a guess gets nothing.
        $intent = PaymentIntent::query()
            ->where('aggregator_tracking_id', $trackingId)
            ->first();

        if ($intent === null) {
            Log::info('payment.ipn_unknown_tracking_id', [
                'provider' => self::PROVIDER,
                'tenant_id' => $tenantId,
            ]);

            return $this->notFound();
        }

        // 4. Idempotency, keyed on the tracking id. Pesapal retries, and a
        //    duplicate is a no-op rather than an error. Claiming BEFORE the
        //    status call also bounds what a replayed notification can cost:
        //    one outbound request per order, not one per delivery.
        //
        //    A claim consumed by a delivery we then fail to read is not a lost
        //    payment. Every intent carries a scheduled reconciliation poll that
        //    performs the same read on the same graduated schedule, and a
        //    webhook is never the only path to resolution in this system.
        $deliveryId = $this->ledger->claim($tenantId, self::PROVIDER, $trackingId);

        if ($deliveryId === null) {
            return $this->accepted();
        }

        // 5. THE ONLY SOURCE OF TRUTH. An authenticated read from Pesapal with
        //    the clinic's own credentials. Nothing from the request reaches
        //    this call except the tracking id it was looked up by.
        try {
            $reported = $this->gateway->fetchStatus($account, $intent);
        } catch (AggregatorUnavailable $e) {
            // Answer 200 anyway. Pesapal retrying a notification will not make
            // Pesapal reachable, and an error status invites it to hammer a
            // public endpoint. The delivery stays recorded as `received`, which
            // is the honest description -- we heard, and could not read -- and
            // reconciliation resolves the intent.
            Log::warning('payment.ipn_status_unavailable', [
                'provider' => self::PROVIDER,
                'tenant_id' => $tenantId,
                'payment_intent_id' => $intent->id,
                // Identifiers and the provider's own words about reachability.
                // Never a credential: PesapalClient constructs these messages
                // and never puts one in them.
                'reason' => $e->getMessage(),
            ]);

            return $this->accepted();
        }

        // 6. The fraud boundary and the transition, in the SAME resolver the
        //    signed Flutterwave webhook and the reconciliation poll use. The
        //    amount Pesapal reported is compared against the stored intent and
        //    a mismatch applies no state change, exactly as it does on every
        //    other path -- one implementation, so the boundary cannot drift.
        $outcome = $this->resolver->apply($intent, $reported, 'pesapal_ipn');

        $this->ledger->recordOutcome($deliveryId, $outcome);

        // Nothing from the notification is stored against the intent. There is
        // nothing in it worth keeping: no status, no amount, no signature. What
        // mattered came from the status call and is already on the intent.
        return $this->accepted();
    }

    /**
     * The only success body this endpoint ever returns.
     *
     * No internal detail, no intent id, no state. The endpoint is public and
     * its responses are an information-disclosure surface.
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
