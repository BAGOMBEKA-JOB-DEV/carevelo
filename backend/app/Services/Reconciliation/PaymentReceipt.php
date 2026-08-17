<?php

namespace App\Services\Reconciliation;

use App\Audit\AuditLog;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Models\Tenant;
use App\Tenancy\TenantContext;

/**
 * Decides whether a payment attempt has a receipt, and who the payee is.
 *
 * Both answers are narrow on purpose. Only a SUCCEEDED intent has a receipt --
 * a pending mobile-money collection may still fail, and a document saying money
 * was received is one a patient will produce later to prove they paid. And the
 * payee is always the clinic, resolved from the bound tenant rather than from
 * anything on the intent, because there is no other party this platform could
 * honestly name: it never took the money.
 *
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 */
class PaymentReceipt
{
    public function __construct(
        protected AuditLog $audit,
        protected TenantContext $context,
    ) {}

    /**
     * The payee for this intent's receipt.
     *
     * @throws IllegalTransition when the payment has not succeeded
     */
    public function issue(PaymentIntent $intent): Tenant
    {
        if ($intent->status !== PaymentIntentStatus::Succeeded) {
            throw new IllegalTransition(sprintf(
                'There is no receipt for a payment nobody has confirmed. This attempt is %s; '
                .'a receipt is issued once the aggregator reports the collection succeeded, or '
                .'once a member of staff attests the cash.',
                $intent->status->value,
            ));
        }

        // Resolved from the tenant bound by the middleware -- from the host or
        // the session, never from a field on the request. A payee taken from
        // client input is a payee an attacker chooses.
        $payee = Tenant::query()->findOrFail($this->context->currentOrFail());

        // A receipt is a financial document leaving the clinic. Who asked for
        // it, and against which attempt, is worth having later.
        $this->audit->record(
            'payment_intent.receipt_issued',
            subjectType: 'PaymentIntent',
            subjectId: $intent->id,
            metadata: ['reference' => $intent->reference],
        );

        return $payee;
    }
}
