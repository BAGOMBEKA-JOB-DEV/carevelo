<?php

namespace App\Support\Consent;

use App\Exceptions\StateMachine\IllegalTransition;
use App\Models\ConsentRecord;

/**
 * Whether this patient has agreed to their address reaching a rider.
 *
 * ONE implementation, deliberately. Two endpoints ask the question -- choosing
 * delivery as the fulfilment method, and dispatching the order to a rider -- and
 * they must not be able to disagree. A copy that drifted would mean an order
 * accepted for delivery at the counter and then refused at dispatch, or worse,
 * the reverse.
 *
 * delivery_disclosure is captured at the point delivery is chosen, not at
 * registration: consent under DPPA 2019 must be SPECIFIC, and asking up front
 * for a disclosure that may never happen is not specific.
 *
 * Consent is WRITTEN only by ConsentController, which owns the policy text and
 * the hash taken over it. This class only reads. Capturing a consent needs the
 * exact wording the patient saw, and a second writer would pin a hash to text it
 * had reproduced by hand.
 *
 * @see docs/50-security-compliance/data-protection-dppa.md
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md
 */
class DeliveryDisclosure
{
    /** The consent that must exist before an address may reach a rider. */
    public const CONSENT_TYPE = 'delivery_disclosure';

    /**
     * Withdrawal is a new record rather than an edit, so the LATEST record
     * decides -- an old grant does not survive a later withdrawal.
     */
    public function isGrantedFor(string $patientId): bool
    {
        $latest = ConsentRecord::query()
            ->where('patient_id', $patientId)
            ->where('consent_type', self::CONSENT_TYPE)
            ->orderByDesc('occurred_at')
            ->orderByDesc('id')
            ->first();

        return $latest?->action === 'granted';
    }

    /**
     * Refuse the delivery path without consent.
     *
     * The message offers collection, because the patient is standing at the
     * counter and "not permitted" without an alternative is not an answer they
     * can act on.
     */
    public function assertGrantedFor(string $patientId): void
    {
        if ($this->isGrantedFor($patientId)) {
            return;
        }

        throw new IllegalTransition(
            'This patient has not agreed to their address being shared with a rider. '
            .'Capture delivery consent first, or offer collection at the pharmacy instead.'
        );
    }
}
