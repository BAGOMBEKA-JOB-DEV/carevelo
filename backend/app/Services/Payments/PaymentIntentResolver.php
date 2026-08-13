<?php

namespace App\Services\Payments;

use App\Audit\AuditLog;
use App\Events\PaymentIntentFailed;
use App\Events\PaymentIntentSucceeded;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;

/**
 * Applies a reported outcome to a payment intent.
 *
 * The single place a webhook and a reconciliation poll converge. They race by
 * design -- missed webhooks are ordinary in this market -- and whichever
 * resolves first wins while the other is a harmless no-op. Both entering here
 * is what makes that true, and it means the fraud boundary in step one below is
 * enforced once rather than twice with a drift between the copies.
 *
 * Note what this class cannot do: it never invents an outcome, never accepts
 * an amount it was told, and never moves money. It records what an aggregator
 * reported about the clinic's own collection.
 *
 * @see docs/40-api/webhooks.md
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 */
final class PaymentIntentResolver
{
    public function __construct(private readonly AuditLog $audit) {}

    /**
     * @param  string  $source  'webhook' or 'reconciliation' -- for the audit trail
     */
    public function apply(PaymentIntent $intent, GatewayStatus $reported, string $source): ResolutionOutcome
    {
        $from = $intent->status;

        // 1. THE FRAUD BOUNDARY. Never trust the amount in a report. Accepting
        //    it would let a forged or replayed payload confirm a large booking
        //    against a small payment. A mismatch is flagged for the
        //    administrator and applies NO state change, ever.
        if ($reported->assertsMoneyMoved() && ! $this->amountAgrees($intent, $reported)) {
            $this->audit->record('payment.amount_mismatch_flagged', 'PaymentIntent', $intent->id, [
                'source' => $source,
                'expected_amount_minor' => (int) $intent->amount_minor,
                'reported_amount_minor' => $reported->amountMinor,
                'reported_status' => $reported->status->value,
            ]);

            return ResolutionOutcome::AmountMismatch;
        }

        // 2. Already there. A duplicate delivery or a poll that lost the race:
        //    succeeded -> succeeded changes nothing and is not an error.
        if ($from === $reported->status) {
            return ResolutionOutcome::NoChange;
        }

        try {
            $this->transition($intent, $reported);
        } catch (IllegalTransition) {
            // The aggregator reported something this intent cannot reach --
            // most often a success arriving after we recorded an explicit
            // failure. Retrying will not help and guessing would be worse, so
            // it is flagged for a human and the state is left alone.
            $this->audit->record('payment.illegal_transition_flagged', 'PaymentIntent', $intent->id, [
                'source' => $source,
                'from' => $from->value,
                'reported_status' => $reported->status->value,
            ]);

            return ResolutionOutcome::IllegalTransition;
        }

        $this->audit->record('payment.resolution_applied', 'PaymentIntent', $intent->id, [
            'source' => $source,
            'from' => $from->value,
            'to' => $intent->status->value,
        ]);

        return ResolutionOutcome::Applied;
    }

    private function amountAgrees(PaymentIntent $intent, GatewayStatus $reported): bool
    {
        // A report claiming money moved but carrying no amount is as
        // untrustworthy as one carrying the wrong amount: there is nothing to
        // check it against.
        return $reported->amountMinor !== null && $intent->amountMatches($reported->amountMinor);
    }

    private function transition(PaymentIntent $intent, GatewayStatus $reported): void
    {
        // An intent still `initiated` means we never saw the push acknowledged.
        // A confirmation proves it was, so walk it through `pending` rather
        // than rejecting a payment the patient has already made.
        if ($intent->status === PaymentIntentStatus::Initiated && $reported->status !== PaymentIntentStatus::Failed) {
            $intent->transitionTo(PaymentIntentStatus::Pending);
            $intent->save();
        }

        match ($reported->status) {
            // Reachable from timed_out, and that is the point: mobile-money
            // confirmations arrive late, and treating a timeout as definitive
            // failure produces the worst outcome available -- a patient charged
            // for a booking that was cancelled.
            PaymentIntentStatus::Succeeded => $this->succeed($intent, $reported),
            PaymentIntentStatus::Failed => $this->fail($intent, $reported),
            PaymentIntentStatus::Reversed => $this->markReversed($intent, $reported),
            default => $this->markPending($intent),
        };
    }

    /**
     * Resolve as succeeded and tell the waiting client.
     *
     * A broadcast is a hint to refresh, never authoritative -- which matters
     * most here. A client must never treat a frame as confirmation that a
     * patient paid; it re-reads the intent through the authorised API.
     */
    private function succeed(PaymentIntent $intent, GatewayStatus $reported): void
    {
        $intent->markSucceeded($reported->aggregatorReference);

        event(PaymentIntentSucceeded::from($intent));
    }

    private function fail(PaymentIntent $intent, GatewayStatus $reported): void
    {
        $intent->markFailed($reported->failureCode, $reported->failureMessage);

        event(PaymentIntentFailed::from($intent));
    }

    /**
     * Rare, and always human-handled afterwards.
     *
     * Recording a reversal is not undoing anything: the money never passed
     * through Carevelo, so there is nothing here to reverse. It is the clinic's
     * own aggregator that moved it back, and this is the note that it did.
     */
    private function markReversed(PaymentIntent $intent, GatewayStatus $reported): void
    {
        $intent->transitionTo(PaymentIntentStatus::Reversed);

        if ($reported->aggregatorReference !== null) {
            $intent->aggregator_reference = $reported->aggregatorReference;
        }

        $intent->next_poll_at = null;
        $intent->save();
    }

    private function markPending(PaymentIntent $intent): void
    {
        $intent->transitionTo(PaymentIntentStatus::Pending);
        $intent->save();
    }
}
