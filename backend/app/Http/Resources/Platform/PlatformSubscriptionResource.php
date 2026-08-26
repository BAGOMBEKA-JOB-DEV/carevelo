<?php

namespace App\Http\Resources\Platform;

use App\Models\PlatformSubscriptionCharge;
use App\Models\Tenant;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Collection;

/**
 * A clinic's commercial relationship with Carevelo, as the platform sees it.
 *
 * MONEY IS `{amount_minor, currency}` throughout, like every other amount this
 * API returns. A bare number would be a currency waiting to be assumed, and the
 * assumption would be made by whichever client formatted it first.
 *
 * NOTE WHAT IS NOT HERE, in two directions.
 *
 * Nothing clinical, and nothing aggregated from clinical data: no patient count,
 * no consultation volume, not even as a number that might justify a tier. A
 * platform role reaches tenant administration and no clinical record, and an
 * aggregate is still an observation about a clinic's patients.
 *
 * No credential of any kind, and specifically no fragment of the PLATFORM's own
 * Pesapal credentials. They live in configuration, they are read only by
 * PesapalClient, and no code path puts them in a response body -- but a
 * subscription resource is exactly where a well-meaning "which merchant account
 * is this collecting into?" field would one day be added, so the absence is
 * stated rather than left to be noticed.
 *
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 *
 * @mixin Tenant
 */
class PlatformSubscriptionResource extends JsonResource
{
    /**
     * @param  Collection<int, PlatformSubscriptionCharge>  $charges
     */
    public function __construct(Tenant $tenant, private readonly Collection $charges)
    {
        parent::__construct($tenant);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $price = $this->plan_price;

        return [
            'tenant_id' => $this->id,
            'legal_name' => $this->legal_name,

            'plan' => $this->plan?->value,
            'price' => $price === null ? null : [
                'amount_minor' => $price->amountMinor,
                'currency' => $price->currency->value,
            ],

            /*
             * The two dates that decide whether staff can sign in tomorrow.
             *
             * UTC on the wire and rendered in Africa/Kampala by the client, like
             * every other instant this API returns.
             */
            'trial_ends_at' => $this->trial_ends_at?->toIso8601String(),
            'current_period_ends_at' => $this->current_period_ends_at?->toIso8601String(),

            /*
             * `suspended` means STAFF SIGN-IN IS BLOCKED and nothing else. It
             * does not mean the clinic's patients lose access to their own
             * records, it does not stop a delivery already in flight, and it
             * never means an export can be withheld. Stated on the wire because
             * a console showing "suspended" without it invites a support agent
             * to believe the clinic is switched off.
             */
            'status' => $this->status->value,

            'recent_charges' => $this->charges
                ->map(fn (PlatformSubscriptionCharge $charge): array => [
                    'id' => $charge->id,
                    'plan' => $charge->plan->value,
                    'amount' => [
                        'amount_minor' => $charge->amount->amountMinor,
                        'currency' => $charge->amount->currency->value,
                    ],
                    'period_starts_on' => $charge->period_starts_on->toDateString(),
                    'period_ends_on' => $charge->period_ends_on->toDateString(),
                    'status' => $charge->status->value,
                    'merchant_reference' => $charge->merchant_reference,
                    // Pesapal's confirmation code. An identifier for a support
                    // conversation, never a fact anything acts on.
                    'aggregator_reference' => $charge->aggregator_reference,
                    'failure_code' => $charge->failure_code,
                    'initiated_at' => $charge->initiated_at->toIso8601String(),
                    'resolved_at' => $charge->resolved_at?->toIso8601String(),
                ])
                ->all(),
        ];
    }
}
