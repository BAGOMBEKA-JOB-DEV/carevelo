<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\PaymentIntentResource;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Models\PaymentMethod;
use App\Support\ReferenceGenerator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;

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
    ) {}

    /**
     * Create a payment intent.
     *
     * Idempotency-Key is REQUIRED. Replaying it with an identical body returns
     * the stored response without re-executing; replaying with a different body
     * is a client bug and returns 409, because silently processing it is how
     * money goes missing.
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

        $intent = PaymentIntent::create([
            'reference' => $this->references->next('PAY'),
            'payable_type' => $validated['payable_type'],
            'payable_id' => $validated['payable_id'],
            'amount_minor' => $validated['amount_minor'],
            'currency' => 'UGX',
            'method' => $method,
            'aggregator' => $method->requiresAggregator() ? 'flutterwave' : null,
            'idempotency_key' => $key,
            'request_fingerprint' => $fingerprint,
            'status' => PaymentIntentStatus::Initiated,
            'initiated_at' => Date::now(),
        ]);

        $this->audit->record(
            'payment_intent.created',
            subjectType: 'PaymentIntent',
            subjectId: $intent->id,
            metadata: ['reference' => $intent->reference, 'method' => $method->value],
        );

        return (new PaymentIntentResource($intent))->response()->setStatusCode(201);
    }

    public function show(PaymentIntent $paymentIntent): PaymentIntentResource
    {
        $this->authorize('view', $paymentIntent);

        return new PaymentIntentResource($paymentIntent);
    }
}
