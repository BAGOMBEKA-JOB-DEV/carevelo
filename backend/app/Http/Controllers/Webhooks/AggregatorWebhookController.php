<?php

namespace App\Http\Controllers\Webhooks;

use App\Audit\AuditLog;
use App\Http\Controllers\Controller;
use App\Http\Responses\ProblemDetails;
use App\Models\PaymentIntent;
use App\Models\Tenant;
use App\Services\Payments\AggregatorAccounts;
use App\Services\Payments\AggregatorCallback;
use App\Services\Payments\CallbackRedactor;
use App\Services\Payments\PaymentIntentResolver;
use App\Services\Payments\ResolutionOutcome;
use App\Services\Payments\WebhookDeliveryLedger;
use App\Services\Payments\WebhookSignature;
use App\Tenancy\Tenancy;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Inbound aggregator callbacks.
 *
 * A small surface with a high consequence: this endpoint decides whether a
 * patient's appointment is confirmed, and it is unauthenticated by nature --
 * the aggregator has no session with us.
 *
 * Two boundaries carry the whole design. STEP 3 is the security boundary:
 * everything before it, including the tenant named in the path, is untrusted
 * input. STEP 8 is the fraud boundary: the amount in a callback is compared
 * against the stored intent and never believed.
 *
 * Handling must finish in under 200ms. Aggregators time out and retry, which
 * multiplies load exactly when the system is already slow -- so this verifies,
 * validates, applies one transition and returns. Notifications, receipts and
 * PDF rendering are queued off the domain events the transition emits, never
 * done on this thread.
 *
 * @see docs/40-api/webhooks.md
 */
class AggregatorWebhookController extends Controller
{
    public function __construct(
        private readonly Tenancy $tenancy,
        private readonly AuditLog $audit,
        private readonly AggregatorAccounts $accounts,
        private readonly WebhookSignature $signatures,
        private readonly WebhookDeliveryLedger $ledger,
        private readonly PaymentIntentResolver $resolver,
        private readonly CallbackRedactor $redactor,
    ) {}

    public function __invoke(Request $request, string $provider, string $tenant): JsonResponse
    {
        // 1. Resolve the tenant named in the path.
        //
        // This is the one place tenancy comes from the request, because a
        // webhook arrives with no host-based context and no session. It is NOT
        // trusted yet: a forged segment fails step 3 against that tenant's own
        // secret. Neutral 404 -- the endpoint is public, and confirming which
        // clinics use Carevelo is itself a disclosure.
        $resolved = Tenant::query()->find($tenant)
            ?? Tenant::query()->where('slug', $tenant)->first();

        if ($resolved === null) {
            Log::info('payment.webhook_unknown_tenant', ['provider' => $provider]);

            return $this->notFound();
        }

        // Entering tenant context scopes row-level security; it grants no
        // trust. Nothing is written before the signature verifies, and the
        // audit event for a rejected signature belongs to the tenant that was
        // targeted -- so the affected clinic sees the attempt in its own trail.
        return $this->tenancy->run(
            $resolved->id,
            fn (): JsonResponse => $this->process($request, $provider, $resolved->id),
        );
    }

    private function process(Request $request, string $provider, string $tenantId): JsonResponse
    {
        // 2. The tenant's own webhook secret, configured during onboarding.
        //    Unconfigured is a 404, indistinguishable from an unknown tenant.
        $account = $this->accounts->forProvider($provider);
        $secret = $account === null ? null : $this->accounts->webhookSecret($account);

        if ($secret === null) {
            Log::info('payment.webhook_unconfigured', ['provider' => $provider, 'tenant_id' => $tenantId]);

            return $this->notFound();
        }

        // 3. THE SECURITY BOUNDARY. Verified against the RAW body, before any
        //    parsing: re-serialising JSON changes the bytes the digest covers.
        $rawBody = $request->getContent();

        if (! $this->signatures->verify($rawBody, $this->signatures->fromRequest($request), $secret)) {
            // Not a client error to be quietly discarded. It is either a
            // misconfiguration or an attempt to forge a payment confirmation,
            // and both deserve a permanent record.
            $this->audit->record('payment.webhook_signature_rejected', metadata: [
                'provider' => $provider,
                'body_bytes' => strlen($rawBody),
            ]);

            return ProblemDetails::make(401, 'invalid_signature', 'Signature verification failed');
        }

        // 4-5. Parse. Everything from here is verified as having come from the
        //      aggregator -- which says nothing about whether it is true.
        $payload = json_decode($rawBody, true);

        if (! is_array($payload)) {
            return $this->malformed();
        }

        $callback = AggregatorCallback::fromPayload($payload);

        if ($callback === null) {
            return $this->malformed();
        }

        // 6. Unknown reference: 200, not 500. Retrying us forever will not
        //    conjure the intent into existence, and an error status encourages
        //    the aggregator to hammer a public endpoint. It usually means a
        //    callback for a different environment.
        $intent = PaymentIntent::query()->where('reference', $callback->reference)->first();

        if ($intent === null) {
            Log::info('payment.callback_unknown_reference', [
                'provider' => $provider,
                'tenant_id' => $tenantId,
                'reference' => $callback->reference,
            ]);

            return $this->accepted();
        }

        // 7. Idempotency. Aggregators retry; a duplicate is a no-op, not an
        //    error. Without this, two deliveries of one success callback could
        //    confirm an appointment twice.
        $deliveryId = $this->ledger->claim($tenantId, $provider, $callback->eventId);

        if ($deliveryId === null) {
            return $this->accepted();
        }

        // 8-9. The fraud boundary and the transition, both inside the resolver
        //      so a reconciliation poll applies exactly the same rules.
        $outcome = $this->resolver->apply($intent, $callback->reported, 'webhook');

        $this->ledger->recordOutcome($deliveryId, $outcome);

        if ($outcome === ResolutionOutcome::Applied) {
            // Kept against the intent for dispute resolution, PII-redacted.
            // Nothing clinical appears in a payment callback in the first place.
            $intent->fill(['raw_callback_payload' => $this->redactor->redact($payload)])->save();
        }

        // 10. Fast 200.
        return $this->accepted();
    }

    /**
     * The only success body this endpoint ever returns.
     *
     * No internal detail, no intent id, no state. The endpoint is public and
     * its responses are an information-disclosure surface: a caller without a
     * valid signature should learn nothing by probing it, and a caller with one
     * should learn nothing beyond the fact of delivery.
     */
    private function accepted(): JsonResponse
    {
        return new JsonResponse(['received' => true], 200);
    }

    private function malformed(): JsonResponse
    {
        return ProblemDetails::make(400, 'malformed_payload', 'The callback could not be read');
    }

    private function notFound(): JsonResponse
    {
        return ProblemDetails::make(404, 'not_found', 'Not found');
    }
}
