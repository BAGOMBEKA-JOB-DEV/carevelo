<?php

namespace App\Jobs;

use App\Audit\AuditLog;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Services\Payments\AggregatorAccounts;
use App\Services\Payments\AggregatorUnavailable;
use App\Services\Payments\PaymentGateway;
use App\Services\Payments\PaymentIntentResolver;
use App\Services\Payments\ResolutionOutcome;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * Asks the aggregator what became of one payment attempt.
 *
 * A WEBHOOK IS NEVER THE ONLY PATH TO RESOLUTION. Missed and delayed webhooks
 * are ordinary in this market, and an intent stuck in `pending` forever is a
 * patient who does not know whether they paid. So every intent carries a
 * scheduled poll, the two paths race, and whichever resolves first wins while
 * the other is a harmless no-op.
 *
 * The rule worth internalising: `timed_out` is NOT final. A late mobile-money
 * confirmation moves it to `succeeded`. Treating a timeout as definitive
 * failure produces the worst outcome available -- a patient charged for a
 * booking that was cancelled on our side.
 *
 * @see docs/40-api/webhooks.md
 * @see docs/10-product/prd-h5-payments-non-custodial.md
 */
class ReconcilePaymentIntentJob extends TenantAwareJob
{
    /**
     * Past this age an unresolved intent stops being a payment we are waiting
     * on and starts being a discrepancy someone has to look at.
     */
    private const ABANDON_AFTER_SECONDS = 86_400;

    /** The point at which waiting becomes `timed_out` -- still not final. */
    private const TIME_OUT_AFTER_SECONDS = 3_600;

    public function __construct(public readonly string $paymentIntentId)
    {
        parent::__construct();

        // Reconciliation must never delay a patient-facing notification or a
        // payment webhook.
        $this->onQueue('low');
    }

    protected function handleForTenant(): void
    {
        $intent = PaymentIntent::query()->find($this->paymentIntentId);

        if ($intent === null) {
            return;
        }

        if ($intent->status->isResolved()) {
            // The webhook won the race. The loser does nothing, by design.
            return;
        }

        $provider = $intent->aggregator;
        $account = is_string($provider) && $provider !== ''
            ? app(AggregatorAccounts::class)->forProvider($provider)
            : null;

        if ($account === null) {
            // Nothing to poll: cash at the clinic, or credentials removed.
            // Continuing to ask every minute would be a loop with no answer.
            $this->stopPolling($intent, 'no_aggregator_account');

            return;
        }

        $age = $this->ageInSeconds($intent);

        if ($age >= self::ABANDON_AFTER_SECONDS) {
            $this->abandon($intent);

            return;
        }

        try {
            // The clinic's OWN credentials. There is no platform merchant
            // account to fall back on, because no such account exists.
            $reported = app(PaymentGateway::class)->fetchStatus($account, $intent);
        } catch (AggregatorUnavailable $e) {
            // An aggregator outage must not spin the queue. Back off onto the
            // graduated schedule and ask again later. Identifiers only: the
            // message may name the provider, never a credential.
            Log::warning('payment.reconciliation_unavailable', [
                'payment_intent_id' => $intent->id,
                'provider' => $provider,
                'reason' => $e->getMessage(),
            ]);

            $intent->scheduleNextPoll();

            return;
        }

        $outcome = app(PaymentIntentResolver::class)->apply($intent, $reported, 'reconciliation');

        // Anything short of an applied, resolving report means we are still
        // waiting: a mismatch the resolver refused, a transition it flagged, or
        // simply nothing yet from the patient's handset.
        if ($outcome !== ResolutionOutcome::Applied || ! $reported->status->isResolved()) {
            $this->keepWaiting($intent, $age);
        }
    }

    /**
     * Still nothing. Age the intent along and schedule the next attempt.
     */
    private function keepWaiting(PaymentIntent $intent, int $age): void
    {
        if ($intent->status === PaymentIntentStatus::Pending && $age >= self::TIME_OUT_AFTER_SECONDS) {
            $intent->markTimedOut();
        }

        $intent->scheduleNextPoll();
    }

    /**
     * Twenty-four hours with no answer.
     *
     * Recorded as failed and flagged for the administrator, who can check the
     * reference against their own aggregator dashboard. We cannot tell them
     * what happened to the money -- we never saw it.
     */
    private function abandon(PaymentIntent $intent): void
    {
        $from = $intent->status;

        $intent->markFailed(
            'no_confirmation',
            'No confirmation was received from the aggregator within 24 hours.',
        );

        app(AuditLog::class)->record('payment.reconciliation_abandoned', 'PaymentIntent', $intent->id, [
            'from' => $from->value,
            'poll_attempts' => $intent->poll_attempts,
        ]);
    }

    private function stopPolling(PaymentIntent $intent, string $reason): void
    {
        $intent->next_poll_at = null;
        $intent->save();

        Log::info('payment.reconciliation_stopped', [
            'payment_intent_id' => $intent->id,
            'reason' => $reason,
        ]);
    }

    /**
     * How old this attempt is, BY THE DATABASE CLOCK.
     *
     * Deliberately not `now()->diffInSeconds($intent->initiated_at)`. A queue
     * worker's clock and the database's need not agree, and workers are the
     * machines most likely to drift -- so a payment timed out by a skewed
     * worker clock is a defect that would surface only under load, on one node,
     * intermittently. One authority for time, and it is the one that stamped
     * the row.
     */
    private function ageInSeconds(PaymentIntent $intent): int
    {
        $row = DB::table('payment_intents')
            ->where('id', $intent->id)
            ->selectRaw('extract(epoch from (now() - initiated_at)) as age_seconds')
            ->first();

        $age = $row->age_seconds ?? null;

        return is_numeric($age) ? (int) $age : 0;
    }
}
