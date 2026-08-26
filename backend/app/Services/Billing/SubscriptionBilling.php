<?php

namespace App\Services\Billing;

use App\Models\PlatformSubscriptionCharge;
use App\Models\SubscriptionChargeStatus;
use App\Models\SubscriptionPlan;
use App\Models\Tenant;
use App\Services\Payments\AggregatorPayload;
use App\Services\Payments\AggregatorUnavailable;
use App\Services\Payments\CollectionHandoff;
use App\Services\Payments\Pesapal\PesapalClient;
use App\Support\Money;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Str;

/**
 * Sets up a clinic's recurring subscription at Pesapal.
 *
 * CAREVELO IS THE MERCHANT. This is the one place in the system where that is
 * true, and everything about the class is arranged so it cannot become true
 * anywhere else: it takes a PlatformMerchant, which can only produce platform
 * credentials, and it never sees an AggregatorAccount or a PaymentIntent. There
 * is no branch here that could route a clinic's collection through our account
 * or ours through a clinic's, because neither object is in scope.
 *
 * ADR-0003 SS-Consequences is the permission and the whole of it: "Revenue is
 * subscription-only". A clinic paying Carevelo for software is not custody of a
 * patient's funds and never touches any; a patient paying a clinic still settles
 * to the clinic with the clinic's own credentials, on a code path this one
 * cannot reach.
 *
 * WHAT PESAPAL CALLS THIS. A recurring collection is an ordinary
 * SubmitOrderRequest carrying two extra things:
 *
 *   account_number       -- OUR identifier for the payer, which is the tenant id.
 *                           Pesapal echoes it back on every recurring transaction
 *                           as `subscription_transaction_info.account_reference`,
 *                           and that echo is the only trustworthy statement of
 *                           WHICH CLINIC PAID that this system will act on.
 *
 *   subscription_details -- start_date, end_date and frequency, with the dates in
 *                           dd-MM-yyyy, which is not the format anything else in
 *                           this codebase uses and is the format Pesapal requires.
 *
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 * @see docs/70-decisions/0012-pesapal-unsigned-ipn.md
 */
final class SubscriptionBilling
{
    /** Pesapal's vocabulary, not ours. The only frequency this system offers. */
    private const FREQUENCY = 'MONTHLY';

    /** Pesapal accepts alphanumerics plus these four, up to fifty characters. */
    private const MERCHANT_REFERENCE_PATTERN = '/^[A-Za-z0-9\-_.:]{1,50}$/';

    /** Pesapal truncates beyond this; we would rather choose where. */
    private const DESCRIPTION_MAX = 100;

    public function __construct(
        private readonly PesapalClient $client,
        private readonly PlatformMerchant $merchant,
    ) {}

    /**
     * Start the clinic's subscription and return where its administrator pays.
     *
     * MOVES NO MONEY, here or ever. It records the charge we expect, tells
     * Pesapal that a recurring collection is authorised against Carevelo's
     * account, and hands back a URL. Pesapal executes the schedule from then on
     * and tells us about each transaction through the notification endpoint.
     *
     * Runs OUTSIDE any tenant context by construction: the charge row lives
     * behind a policy that refuses a write with a tenant bound, so calling this
     * inside Tenancy::run() writes nothing and is caught immediately rather than
     * silently filing the platform's revenue under a clinic.
     */
    public function start(Tenant $tenant): CollectionHandoff
    {
        $plan = $tenant->plan;
        $price = $tenant->plan_price;

        if (! $plan instanceof SubscriptionPlan || ! $price instanceof Money || $price->amountMinor <= 0) {
            // A clinic with no agreed plan is not a billing failure, it is a
            // clinic nobody has sold to yet. Refusing here keeps the sweep and
            // the console honest about which of the two they are looking at.
            throw new AggregatorUnavailable('This clinic has no subscription plan and price agreed.');
        }

        $credentials = $this->merchant->credentials();
        $notificationId = $this->merchant->notificationId();

        if (! $credentials->isConfigured() || $notificationId === null) {
            // Deliberately NOT a fallback to anything. The only other Pesapal
            // credentials in this system belong to clinics, and reaching for one
            // of those would collect Carevelo's subscription fee into a clinic's
            // merchant account -- which is both a theft and the exact blending of
            // the two money paths this domain exists to prevent.
            throw new AggregatorUnavailable('Platform subscription billing is not configured.');
        }

        $this->refuseSecondMandate($tenant);

        $period = SubscriptionPeriod::next($tenant, Date::now());
        $reference = $this->reference();

        /*
         * THE ORDER HERE IS DELIBERATE: Pesapal first, our row second.
         *
         * The patient path does the opposite -- PaymentIntentController writes
         * the intent and then attempts the handoff -- and it is right to,
         * because an intent left `initiated` by a failed handoff is picked up by
         * the reconciliation sweep on its graduated schedule. THERE IS NO SUCH
         * SWEEP HERE. A subscription charge written before a handoff that then
         * failed could never be resolved by anything, and would sit in the
         * operator's console for ever looking like a collection in progress.
         *
         * The reverse risk -- Pesapal accepts the order and the write below
         * fails, leaving a mandate at Pesapal with no local record -- is real and
         * is already handled: the first recurring notification arrives with a
         * tracking id we do not know, which is the ordinary month-two case, and
         * RecurringChargeResolver creates the charge from the clinic's register
         * row. So the recovery path for this failure is one that is exercised
         * every month rather than one written for an emergency.
         */
        $handoff = $this->client->submitOrderUsing($credentials, [
            'id' => $reference,
            'currency' => $price->currency->value,
            'amount' => $this->amount($price),
            'description' => $this->description($reference),
            'callback_url' => $this->callbackUrl(),
            'notification_id' => $notificationId,
            'billing_address' => $this->billingAddress($tenant),

            /*
             * OUR identifier for the payer. The tenant id, and it must stay the
             * tenant id: it is what comes back on every recurring transaction as
             * `account_reference`, and it is the only thing that will ever tell
             * us which clinic a Pesapal-initiated charge belongs to.
             *
             * A ULID is opaque to anyone reading a Pesapal dashboard, which is
             * the right trade -- a legal name there would tell Pesapal's staff
             * which clinics use Carevelo, and that is our customers' business.
             */
            'account_number' => $tenant->id,

            'subscription_details' => [
                // dd-MM-yyyy. Pesapal's format, used nowhere else in this
                // codebase, and silently rejected in any other shape.
                'start_date' => $period->pesapalStartDate(),
                'end_date' => $period->pesapalEndDate(),
                'frequency' => self::FREQUENCY,
            ],
        ]);

        // The tracking id is stored so a notification about this FIRST
        // transaction can find the row it belongs to. Months two onward arrive
        // with tracking ids we have never seen, which is why the resolver can
        // also create a charge from scratch.
        PlatformSubscriptionCharge::create([
            'tenant_id' => $tenant->id,
            'plan' => $plan,
            'amount' => $price,
            'period_starts_on' => $period->startsOn,
            'period_ends_on' => $period->endsOn,
            'merchant_reference' => $reference,
            'aggregator_tracking_id' => $handoff->trackingId,
            'initiated_at' => Date::now(),
        ]);

        return $handoff;
    }

    /**
     * Refuse to authorise a second recurring collection for the same clinic.
     *
     * A Pesapal recurring mandate is standing permission to take money every
     * month. Two of them means a clinic pays twice a month, for ever, until
     * somebody notices -- and the person who notices is the clinic, which is the
     * worst possible way for this to surface. A double-clicked button is enough
     * to cause it.
     *
     * The test is "has Pesapal been told about a charge for this clinic that did
     * not fail". A FAILED charge is not a live mandate and does not block a
     * retry; a charge with no tracking id was never handed off and does not
     * either, though the ordering above means one should not exist.
     *
     * WHAT THIS FORECLOSES, stated plainly because it is a real operation
     * somebody will want: changing a clinic's plan mid-subscription does not
     * work by calling this endpoint again. Pesapal's existing mandate has to be
     * cancelled first, by a person, in Pesapal's own console. That is
     * inconvenient and it is the safe direction of the two -- the alternative is
     * a clinic silently billed for both plans.
     */
    private function refuseSecondMandate(Tenant $tenant): void
    {
        $live = PlatformSubscriptionCharge::query()
            ->where('tenant_id', $tenant->id)
            ->whereNotNull('aggregator_tracking_id')
            ->whereIn('status', [
                SubscriptionChargeStatus::Initiated,
                SubscriptionChargeStatus::Succeeded,
                SubscriptionChargeStatus::Reversed,
            ])
            ->exists();

        if ($live) {
            throw new AggregatorUnavailable(
                'This clinic already has a subscription at the aggregator. Cancel the '
                .'existing recurring authorisation before starting another, or a second '
                .'monthly collection will run alongside the first.'
            );
        }
    }

    /**
     * Our own reference, which Pesapal echoes as OrderMerchantReference.
     *
     * A ULID rather than a readable sequence. The readable ones in this system
     * come from ReferenceGenerator, which counts per tenant in an RLS-isolated
     * table -- unreachable from here, correctly, because this is not a tenant's
     * record. A ULID is unique without a counter, sorts by time, and fits
     * Pesapal's fifty characters with room to spare.
     */
    private function reference(): string
    {
        $reference = 'SUB-'.Str::upper((string) Str::ulid());

        if (preg_match(self::MERCHANT_REFERENCE_PATTERN, $reference) !== 1) {
            // Cannot happen with a ULID, and that is why it is checked. A
            // reference Pesapal rejects surfaces as an opaque aggregator error
            // during a clinic's first attempt to pay us.
            throw new AggregatorUnavailable('Our own reference is not in a shape the aggregator accepts.');
        }

        return $reference;
    }

    /**
     * The amount in major units, without ever touching a float.
     *
     * The same arithmetic PesapalGateway performs for a patient's payment, and
     * the same hazard: a minor unit here is one HUNDREDTH OF A SHILLING, so a
     * UGX 250,000 plan is 25,000,000 in the column and 250,000 on the wire. A
     * conversion wrong by that factor would bill a clinic a hundred times its
     * plan AND WOULD PASS THE FRAUD BOUNDARY, because Pesapal would report back
     * the amount we asked for.
     *
     * Duplicated rather than shared with the patient path deliberately. It is
     * four lines, both are tested, and the alternative is a shared service that
     * both money paths call -- which is the first strand of exactly the coupling
     * this domain is separated to avoid.
     */
    private function amount(Money $price): int|string
    {
        $amountMinor = $price->amountMinor;

        // Refuses a negative amount outright, and is the tested inverse of the
        // inbound conversion.
        $decimal = AggregatorPayload::majorUnits($amountMinor);

        return $amountMinor % 100 === 0
            ? intdiv($amountMinor, 100)
            : $decimal;
    }

    /**
     * What Pesapal shows, and prints on its own statements.
     *
     * OUR REFERENCE AND NOTHING ELSE, for the same reason the patient path says
     * nothing: a description lands on a Pesapal receipt, an SMS from the
     * mobile-money operator and a bank statement. Here there is no clinical
     * content to leak, but there is a clinic's identity, and naming it would tell
     * whoever holds the handset which clinic is a Carevelo customer.
     */
    private function description(string $reference): string
    {
        return mb_substr('Carevelo subscription '.$reference, 0, self::DESCRIPTION_MAX);
    }

    /**
     * Where Pesapal returns the ADMINISTRATOR'S BROWSER after the hosted page.
     *
     * Not a trust boundary and not a resolution path: Pesapal appends its own
     * query parameters, and the console it lands on re-reads the subscription
     * through the authorised API rather than believing them.
     */
    private function callbackUrl(): string
    {
        return rtrim((string) config('app.url'), '/').'/platform/billing/return';
    }

    /**
     * How Pesapal reaches the clinic that is paying us.
     *
     * The clinic's own business contact details, which it gave us for exactly
     * this kind of correspondence. NOTHING ABOUT A PATIENT crosses this
     * boundary -- there is nothing here that could, because this class has no
     * access to a patient record and no tenant context in which to read one.
     *
     * @return array<string, ?string>
     */
    private function billingAddress(Tenant $tenant): array
    {
        return [
            'email_address' => $tenant->contact_email,
            'phone_number' => $tenant->contact_phone,
            'country_code' => 'UG',
            'first_name' => $tenant->legal_name,
            'last_name' => null,
        ];
    }
}
