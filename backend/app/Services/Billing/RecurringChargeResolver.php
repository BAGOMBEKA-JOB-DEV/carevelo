<?php

namespace App\Services\Billing;

use App\Audit\AuditLog;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Models\PaymentIntentStatus;
use App\Models\PlatformSubscriptionCharge;
use App\Models\SubscriptionChargeStatus;
use App\Models\SubscriptionPlan;
use App\Models\Tenant;
use App\Services\Payments\Pesapal\PesapalSubscriptionStatus;
use App\Services\Payments\ResolutionOutcome;
use App\Support\Money;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Str;

/**
 * Applies what Pesapal said about a subscription transaction.
 *
 * The platform counterpart of PaymentIntentResolver, and deliberately a separate
 * class rather than a branch inside it. The two enforce the same fraud boundary
 * for the same reason, and they must not enforce it through the same object: one
 * resolver reached by both money paths is one refactor away from a patient's
 * payment resolving against a platform charge, or the reverse, and ADR-0003 says
 * plainly what a drift into custody costs.
 *
 * EVERY FACT ACTED ON HERE CAME FROM GetTransactionStatus. Nothing reaches this
 * class from the notification body -- not the status, not the amount, and above
 * all not the clinic. The controller cannot pass one: its signature takes a
 * tracking id and a status read back from Pesapal, and there is no parameter a
 * forged field could travel in.
 *
 * WHICH CLINIC PAID is the question this class exists to answer safely, and the
 * answer is `subscription_transaction_info.account_reference` -- the
 * `account_number` we set when the subscription was created, echoed back by
 * Pesapal over an authenticated TLS connection. A recurring transaction is
 * initiated by PESAPAL, so its tracking id is one this system has never seen and
 * cannot look a tenant up by; without that echo there is nothing to act on, and
 * this class acts on nothing.
 *
 * @see docs/70-decisions/0012-pesapal-unsigned-ipn.md
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 */
final class RecurringChargeResolver
{
    public function __construct(private readonly AuditLog $audit) {}

    /**
     * Apply a status Pesapal reported to the charge it concerns.
     *
     * Runs with NO TENANT BOUND. That is not an incidental property of the
     * caller: platform_subscription_charges is invisible and unwritable with a
     * tenant bound, so this method reads and writes nothing at all if it is ever
     * called from inside Tenancy::run(). The audit events it writes carry a null
     * tenant_id and land in the platform trail, which is where a record of
     * Carevelo's own revenue belongs -- a clinic's trail is a clinical evidence
     * record, not our accounts.
     */
    public function apply(string $trackingId, PesapalSubscriptionStatus $reported): ResolutionOutcome
    {
        // 1. WHICH CLINIC. From Pesapal's answer and from nowhere else. A
        //    transaction Pesapal reports without subscription information is a
        //    transaction we cannot attribute, and an unattributable payment
        //    extends nobody's subscription.
        $tenant = $this->payer($reported);

        if ($tenant === null) {
            $this->audit->record('platform.subscription_unattributable', metadata: [
                'aggregator_tracking_id' => $trackingId,
                'reported_status' => $reported->status->status->value,
            ]);

            return ResolutionOutcome::UnknownReference;
        }

        // 2. The charge this transaction belongs to. Found by tracking id when we
        //    started it ourselves, and created when Pesapal did -- which is every
        //    month after the first.
        $charge = PlatformSubscriptionCharge::query()
            ->where('aggregator_tracking_id', $trackingId)
            ->first();

        if ($charge !== null && $charge->tenant_id !== $tenant->id) {
            // Pesapal reporting one clinic against a charge recorded for another
            // cannot happen and must never be reconciled by preferring one of
            // them. Flagged, and nothing moves.
            $this->audit->record('platform.subscription_payer_mismatch', 'PlatformSubscriptionCharge', $charge->id, [
                'aggregator_tracking_id' => $trackingId,
            ]);

            return ResolutionOutcome::UnknownReference;
        }

        $charge ??= $this->recordRecurringCharge($tenant, $trackingId);

        if ($charge === null) {
            // A clinic with no plan or price on its register row. Nothing to
            // compare a reported amount against, so there is no safe way to
            // accept one -- and accepting it anyway would mean believing an
            // amount from a report, which is the whole thing we do not do.
            $this->audit->record('platform.subscription_charge_unbilled', 'Tenant', $tenant->id, [
                'aggregator_tracking_id' => $trackingId,
            ]);

            return ResolutionOutcome::UnknownReference;
        }

        return $this->applyToCharge($charge, $tenant, $reported);
    }

    private function applyToCharge(
        PlatformSubscriptionCharge $charge,
        Tenant $tenant,
        PesapalSubscriptionStatus $reported,
    ): ResolutionOutcome {
        $status = $reported->status;
        $from = $charge->status;

        // 3. THE FRAUD BOUNDARY, and it is here for the same reason it is on the
        //    patient path rather than because the shape was copied. The
        //    notification endpoint is public and unauthenticated; if a reported
        //    amount were taken on trust, anyone able to make Pesapal report
        //    anything could extend a clinic's subscription for the price of the
        //    smallest transaction Pesapal will process. A mismatch applies NO
        //    state change, ever.
        if ($status->assertsMoneyMoved() && ! $this->amountAgrees($charge, $status->amountMinor)) {
            $this->audit->record('platform.subscription_amount_mismatch', 'PlatformSubscriptionCharge', $charge->id, [
                'expected_amount_minor' => $charge->amount->amountMinor,
                'reported_amount_minor' => $status->amountMinor,
                'reported_status' => $status->status->value,
            ]);

            return ResolutionOutcome::AmountMismatch;
        }

        $target = $this->target($status->status);

        if ($target === null) {
            // Pesapal reports `pending` for a transaction it has nothing on yet.
            // Nothing to record and nothing to extend; the next notification, or
            // the next month, brings the answer.
            return ResolutionOutcome::NoChange;
        }

        // 4. ALREADY THERE. A replayed notification, or two deliveries racing.
        //    This is the line that stops a clinic's paid-through date being
        //    extended twice for one collection, and it is why the extension
        //    happens only on the transition below and never on the read.
        if ($from === $target) {
            return ResolutionOutcome::NoChange;
        }

        try {
            match ($target) {
                SubscriptionChargeStatus::Succeeded => $charge->markSucceeded($status->aggregatorReference),
                SubscriptionChargeStatus::Failed => $charge->markFailed($status->failureCode),
                SubscriptionChargeStatus::Reversed => $charge->markReversed($status->aggregatorReference),
                default => null,
            };
        } catch (IllegalTransition) {
            // Pesapal reported something this charge cannot reach -- most often a
            // success arriving after a recorded failure. Retrying will not help
            // and guessing would be worse, so it is flagged for a person and the
            // state is left alone.
            $this->audit->record('platform.subscription_illegal_transition', 'PlatformSubscriptionCharge', $charge->id, [
                'from' => $from->value,
                'reported_status' => $status->status->value,
            ]);

            return ResolutionOutcome::IllegalTransition;
        }

        if ($target === SubscriptionChargeStatus::Succeeded) {
            $this->extendPaidThrough($tenant, $charge);
        }

        $this->audit->record('platform.subscription_charge_resolved', 'PlatformSubscriptionCharge', $charge->id, [
            'tenant_id' => $tenant->id,
            'from' => $from->value,
            'to' => $charge->status->value,
        ]);

        return ResolutionOutcome::Applied;
    }

    /**
     * The clinic Pesapal says paid.
     *
     * `account_reference` is the `account_number` set at subscription time, which
     * is the tenant id. Looked up rather than trusted as a fact about anything
     * else: an id naming no clinic resolves to null and nothing happens.
     */
    private function payer(PesapalSubscriptionStatus $reported): ?Tenant
    {
        $reference = $reported->accountReference;

        if ($reference === null || $reference === '') {
            return null;
        }

        return Tenant::query()->find($reference);
    }

    /**
     * A charge for a transaction PESAPAL started.
     *
     * Months two onward are executed by Pesapal on the recurring schedule it was
     * given, so the first this system hears of one is a notification carrying a
     * tracking id it has never seen. The row is written from the clinic's own
     * register entry -- its agreed plan and its agreed price -- and never from
     * anything the notification or the status response said about money. That is
     * what leaves a real amount for the fraud boundary to compare against; a row
     * built from the reported amount would agree with itself by construction.
     */
    private function recordRecurringCharge(Tenant $tenant, string $trackingId): ?PlatformSubscriptionCharge
    {
        $plan = $tenant->plan;
        $price = $tenant->plan_price;

        if (! $plan instanceof SubscriptionPlan || ! $price instanceof Money || $price->amountMinor <= 0) {
            return null;
        }

        $period = SubscriptionPeriod::next($tenant, Date::now());

        return PlatformSubscriptionCharge::create([
            'tenant_id' => $tenant->id,
            'plan' => $plan,
            'amount' => $price,
            'period_starts_on' => $period->startsOn,
            'period_ends_on' => $period->endsOn,
            'merchant_reference' => 'SUB-'.Str::upper((string) Str::ulid()),
            'aggregator_tracking_id' => $trackingId,
            'initiated_at' => Date::now(),
        ]);
    }

    /**
     * A report claiming money moved but carrying no amount is as untrustworthy
     * as one carrying the wrong amount: there is nothing to check it against.
     */
    private function amountAgrees(PlatformSubscriptionCharge $charge, ?int $reportedMinor): bool
    {
        return $reportedMinor !== null && $reportedMinor === $charge->amount->amountMinor;
    }

    /**
     * Move the clinic's paid-through date to the end of the period it just paid.
     *
     * ONLY ON A TRANSITION INTO `succeeded`, never on reading one. That single
     * condition is what makes a replayed notification harmless: the second
     * delivery finds the charge already succeeded, returns NoChange above, and
     * never reaches this line.
     *
     * A reversal deliberately does NOT wind it back. Withdrawing service
     * retroactively over a payments dispute is a decision for a person who can
     * telephone the clinic, and a scheduled sweep is not that person.
     */
    private function extendPaidThrough(Tenant $tenant, PlatformSubscriptionCharge $charge): void
    {
        $paidThrough = $charge->period_ends_on->copy()->endOfDay();

        // Never earlier than where the clinic already is. Notifications can
        // arrive out of order, and an older one must not shorten a subscription.
        if ($tenant->current_period_ends_at !== null && $tenant->current_period_ends_at->isAfter($paidThrough)) {
            return;
        }

        $tenant->current_period_ends_at = $paidThrough;
        $tenant->save();
    }

    /**
     * Pesapal's four outcomes, as this domain's three.
     *
     * `pending` maps to null rather than to a state, because there is no
     * `pending` here: nobody is standing at a counter watching a mobile-money
     * prompt, and a recurring charge Pesapal has nothing on yet is simply one we
     * have not been told about.
     */
    private function target(PaymentIntentStatus $reported): ?SubscriptionChargeStatus
    {
        return match ($reported) {
            PaymentIntentStatus::Succeeded => SubscriptionChargeStatus::Succeeded,
            PaymentIntentStatus::Failed => SubscriptionChargeStatus::Failed,
            PaymentIntentStatus::Reversed => SubscriptionChargeStatus::Reversed,
            default => null,
        };
    }
}
