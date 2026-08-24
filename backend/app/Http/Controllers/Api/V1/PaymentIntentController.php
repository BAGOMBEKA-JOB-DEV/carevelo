<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\PaymentIntentResource;
use App\Http\Resources\V1\ReceiptResource;
use App\Models\AggregatorAccount;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Models\PaymentMethod;
use App\Services\Payments\AggregatorAccounts;
use App\Services\Payments\AggregatorUnavailable;
use App\Services\Payments\CollectionHandoff;
use App\Services\Payments\PaymentGateway;
use App\Services\Reconciliation\PaymentReceipt;
use App\Support\ReferenceGenerator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Records payment attempts. Does not move money.
 *
 * Every collection is initiated against the CLINIC'S OWN aggregator account
 * using the clinic's own credentials, and settles directly to the clinic.
 *
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 */
class PaymentIntentController extends Controller
{
    public function __construct(
        protected AuditLog $audit,
        protected ReferenceGenerator $references,
        protected AggregatorAccounts $accounts,
        protected PaymentGateway $gateway,
    ) {}

    /**
     * Create a payment intent, and hand the collection off if the aggregator
     * works that way.
     *
     * Idempotency-Key is REQUIRED. Replaying it with an identical body returns
     * the stored response without re-executing; replaying with a different body
     * is a client bug and returns 409, because silently processing it is how
     * money goes missing. That guard now protects a real outbound call as well
     * as a row: without it, a retried request would submit a SECOND order
     * against the patient's name.
     *
     * THE HANDOFF IS NOT A PAYMENT. Where the aggregator supports server-side
     * initiation -- Pesapal does, Flutterwave does not -- we tell the CLINIC'S
     * OWN aggregator that a collection is expected and return the page the
     * patient pays on. The patient then pays the aggregator and the aggregator
     * settles to the clinic. Nothing passes through Carevelo at any point, and
     * no account exists here for it to pass through.
     */
    public function store(Request $request): JsonResponse
    {
        $this->authorize('create', PaymentIntent::class);

        $key = $request->header('Idempotency-Key');

        if (! is_string($key) || $key === '') {
            return response()->json([
                'type' => 'https://docs.carevelo.app/errors/idempotency_key_required',
                'title' => 'An Idempotency-Key header is required',
                'status' => 400,
                'code' => 'idempotency_key_required',
                'detail' => 'Generate a UUID and reuse it across retries of the same payment.',
            ], 400, ['Content-Type' => 'application/problem+json']);
        }

        $validated = $request->validate([
            'payable_type' => ['required', 'in:appointment,dispense_order'],
            'payable_id' => ['required', 'string'],
            'amount_minor' => ['required', 'integer', 'min:1'],
            'method' => ['required', 'string'],
        ]);

        $fingerprint = hash('sha256', json_encode($validated) ?: '');

        $existing = PaymentIntent::query()->where('idempotency_key', $key)->first();

        if ($existing !== null) {
            // Same key, different body: a client bug. Never process it.
            if ($existing->request_fingerprint !== $fingerprint) {
                return response()->json([
                    'type' => 'https://docs.carevelo.app/errors/idempotency_key_reused',
                    'title' => 'This Idempotency-Key was used for a different request',
                    'status' => 409,
                    'code' => 'idempotency_key_reused',
                ], 409, ['Content-Type' => 'application/problem+json']);
            }

            // Same key, same body: return what we stored. Do not re-execute.
            return (new PaymentIntentResource($existing))->response()->setStatusCode(200);
        }

        $method = PaymentMethod::from($validated['method']);

        // WHICH aggregator, read off the clinic's own account rather than
        // assumed. It was hard-coded to Flutterwave while that was the only
        // client, which meant a clinic banking with Pesapal recorded attempts
        // against an aggregator it does not hold -- and reconciliation, which
        // looks up the account by this value, then had nothing to poll and
        // stopped. Null where the clinic has no account at all, which is a
        // working state: pay-at-clinic still works and care is never blocked.
        $account = $method->requiresAggregator() ? $this->accounts->current() : null;

        $intent = PaymentIntent::create([
            'reference' => $this->references->next('PAY'),
            'payable_type' => $validated['payable_type'],
            'payable_id' => $validated['payable_id'],
            'amount_minor' => $validated['amount_minor'],
            'currency' => 'UGX',
            'method' => $method,
            'aggregator' => $account?->provider,
            'idempotency_key' => $key,
            'request_fingerprint' => $fingerprint,
            'status' => PaymentIntentStatus::Initiated,
            'initiated_at' => Date::now(),
        ]);

        $handoff = $this->handOff($intent, $account);

        if ($handoff !== null) {
            // Stored, not merely returned. Pesapal's inbound notification
            // carries its tracking id and NOTHING ELSE -- no status, no amount,
            // no signature -- so an unstored tracking id is a payment that can
            // never be tied back to the attempt it settled. The redirect URL is
            // kept so a patient who closes the tab returns to the same hosted
            // page instead of having a second order submitted against them.
            $intent->forceFill([
                'aggregator_tracking_id' => $handoff->trackingId,
                'redirect_url' => $handoff->redirectUrl,
            ])->save();
        }

        $this->audit->record(
            'payment_intent.created',
            subjectType: 'PaymentIntent',
            subjectId: $intent->id,
            // Identifiers and outcomes. No amount is needed here -- it is on the
            // row -- and nothing about what is being paid for ever appears.
            metadata: [
                'reference' => $intent->reference,
                'method' => $method->value,
                'aggregator' => $account?->provider,
                'handed_off' => $handoff !== null,
            ],
        );

        return (new PaymentIntentResource($intent))->response()->setStatusCode(201);
    }

    /**
     * Ask the clinic's own aggregator to open a collection, if it can.
     *
     * Null is an ordinary answer, and TWO DIFFERENT THINGS produce it. The
     * clinic may have no usable account -- unconfigured, or a key awaiting
     * verification -- in which case there was never anything to call. Or the
     * aggregator may refuse: Flutterwave refuses ALWAYS AND BY DESIGN, because
     * its collection is started by the client against Flutterwave and there is
     * no server-side handoff to give, and Pesapal refuses when it is
     * unreachable.
     *
     * None of the three is an error the patient should see as a failed booking.
     * The intent exists either way, reconciliation will poll it either way, and
     * a client that receives no redirect URL falls back to the flow it already
     * has. Turning an aggregator outage into a 5xx here would take a clinic
     * off-line for a dependency it does not need in order to see patients.
     */
    private function handOff(PaymentIntent $intent, ?AggregatorAccount $account): ?CollectionHandoff
    {
        if ($account === null || ! $account->isUsable()) {
            return null;
        }

        try {
            // The CLINIC'S OWN credentials, pushed into the call rather than
            // resolved inside it. There is no platform merchant account to fall
            // back on, because no such account exists.
            return $this->gateway->initiateCollection($account, $intent);
        } catch (AggregatorUnavailable $e) {
            Log::info('payment.no_collection_handoff', [
                'payment_intent_id' => $intent->id,
                'aggregator' => $account->provider,
                // Identifiers and the aggregator's own words about
                // reachability. Never a credential: the clients that raise this
                // never put one in the message.
                'reason' => $e->getMessage(),
            ]);

            return null;
        }
    }

    public function show(PaymentIntent $paymentIntent): PaymentIntentResource
    {
        $this->authorize('view', $paymentIntent);

        return new PaymentIntentResource($paymentIntent);
    }

    /**
     * A named staff member attests that cash was received at the clinic.
     *
     * No aggregator is involved and no money passes through Carevelo — the
     * patient handed notes to a person standing behind a counter. All this
     * records is that a member of the clinic's staff says so, which is why the
     * attestation is attributed and audited: it is the clinic's own internal
     * control, and the audit trail is the only thing that makes it one.
     *
     * ONLY cash_at_clinic. An aggregator-backed collection can never be marked
     * succeeded by hand — that would let a staff member assert a payment the
     * aggregator never confirmed, turning the clinic's own books into fiction
     * and defeating reconciliation, whose whole purpose is to resolve
     * independently of what anyone claims.
     *
     * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md section 3
     * @see docs/50-security-compliance/payments-regulatory-boundary.md
     */
    public function attestCash(PaymentIntent $paymentIntent): PaymentIntentResource
    {
        $this->authorize('attestCash', $paymentIntent);

        if ($paymentIntent->method->requiresAggregator()) {
            throw new IllegalTransition(
                'Only a cash payment taken at the clinic may be attested by staff. '
                .'A mobile-money or card collection is resolved by the aggregator that '
                .'took it, or by reconciliation — never by hand.'
            );
        }

        DB::transaction(function () use ($paymentIntent): void {
            // initiated → pending → succeeded. The intermediate hop is a
            // formality for cash, where nothing is actually awaited, but the
            // state machine is shared with mobile money and is not worth a
            // special case that would have to be kept correct twice.
            //
            // Attesting an already-resolved intent is an IllegalTransition,
            // rendered as 409: cash is not received twice.
            if ($paymentIntent->status === PaymentIntentStatus::Initiated) {
                $paymentIntent->transitionTo(PaymentIntentStatus::Pending);
            }

            $paymentIntent->markSucceeded();

            // WHO attested is the entire value of this record. The actor is
            // taken from the authenticated session by AuditLog, never from the
            // body — a self-reported attester is not a control.
            $this->audit->record(
                'payment_intent.cash_attested',
                subjectType: 'PaymentIntent',
                subjectId: $paymentIntent->id,
                metadata: [
                    'reference' => $paymentIntent->reference,
                    'amount_minor' => $paymentIntent->amount_minor,
                ],
            );
        });

        return new PaymentIntentResource($paymentIntent);
    }

    /**
     * The receipt. It NAMES THE CLINIC AS PAYEE.
     *
     * Carevelo appears nowhere on it in that role, because the clinic is what
     * received the money: the patient paid the clinic's own merchant account and
     * the aggregator settled to the clinic direct. A receipt naming us would be
     * a false document and a claim of custody at once.
     *
     * Only a succeeded intent has one. The precondition and the payee lookup
     * live in PaymentReceipt.
     */
    public function receipt(PaymentIntent $paymentIntent, PaymentReceipt $receipts): ReceiptResource
    {
        $this->authorize('view', $paymentIntent);

        return new ReceiptResource($paymentIntent, $receipts->issue($paymentIntent));
    }
}
