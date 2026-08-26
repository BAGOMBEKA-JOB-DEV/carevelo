<?php

namespace App\Http\Controllers\Api\Platform;

use App\Audit\AuditLog;
use App\Http\Controllers\Controller;
use App\Http\Requests\Platform\UpdateSubscriptionRequest;
use App\Http\Resources\Platform\PlatformSubscriptionResource;
use App\Http\Responses\ProblemDetails;
use App\Models\PlatformSubscriptionCharge;
use App\Models\Tenant;
use App\Services\Billing\SubscriptionBilling;
use App\Services\Payments\AggregatorUnavailable;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Collection;

/**
 * The clinic's subscription to the software, administered by the platform.
 *
 * SELF-SERVICE PLAN SELECTION WAS AN EXPLICIT NON-GOAL FOR H1 -- "early plans
 * are agreed in conversation, which is how this market buys" -- and the
 * amendment in that document explains what changed. What has NOT changed is who
 * agrees a price: this surface is the platform's, an operator records what was
 * agreed with the clinic, and a clinic administrator cannot set its own plan or
 * its own price from the clinic console. There is no route for that anywhere.
 *
 * These routes run WITHOUT ResolveTenant and BindTenantContext along with the
 * rest of the platform group, and here that is load-bearing rather than
 * incidental: platform_subscription_charges carries a policy that makes it
 * invisible and unwritable with any tenant bound, so a handler that ran inside a
 * tenant's context would read an empty list and write nothing while returning
 * 200. The absence of a bound tenant is what makes this controller work at all.
 *
 * Audit events written here carry a null tenant_id and land in the PLATFORM
 * trail. That is deliberate and not a shortcut: a clinic's audit trail is a
 * clinical evidence record, and Carevelo's revenue is not evidence about the
 * clinic's care.
 *
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 * @see docs/10-product/prd-h1-clinic-onboarding.md
 */
class PlatformSubscriptionController extends Controller
{
    /** Enough for a support conversation about the last year, and no more. */
    private const RECENT_CHARGES = 12;

    public function __construct(protected AuditLog $audit) {}

    /**
     * What this clinic is on, and what became of its recent charges.
     */
    public function show(Tenant $tenant): PlatformSubscriptionResource
    {
        $this->authorize('viewAny', Tenant::class);

        return new PlatformSubscriptionResource($tenant, $this->recentCharges($tenant));
    }

    /**
     * Record the plan and the price a clinic agreed.
     *
     * DOES NOT COLLECT ANYTHING. Recording a commercial agreement and asking
     * Pesapal for money are two different acts and are two different endpoints,
     * because a support operator correcting a typo in a price must not thereby
     * charge a clinic.
     *
     * The price is not validated against a published list, and there is no such
     * list in the code. A clinic that negotiated a price keeps it, and a price
     * table would silently re-price every clinic on a tier the day it changed.
     */
    public function update(UpdateSubscriptionRequest $request, Tenant $tenant): PlatformSubscriptionResource
    {
        $this->authorize('update', $tenant);

        $previous = $tenant->plan;

        // Explicit assignment rather than fill(): neither field is in $fillable,
        // deliberately, because a paid-through date or a price that could arrive
        // as a mass-assignable attribute is one a clinic could eventually set for
        // itself. See the note on Tenant::$fillable.
        $tenant->plan = $request->plan();
        $tenant->plan_price = $request->price();
        $tenant->save();

        $this->audit->record(
            'platform.subscription_plan_agreed',
            subjectType: 'Tenant',
            subjectId: $tenant->id,
            metadata: [
                'from' => $previous?->value,
                'to' => $request->plan()->value,
                // The amount, because a change to what a clinic pays is exactly
                // the thing a later dispute turns on. No credential, no clinical
                // content: this is a commercial fact about a company.
                'price_minor' => $request->price()->amountMinor,
            ],
        );

        return new PlatformSubscriptionResource($tenant, $this->recentCharges($tenant));
    }

    /**
     * Start the recurring collection at Pesapal.
     *
     * CAREVELO IS THE MERCHANT and this is the only endpoint in the product for
     * which that is true. It moves no money: it records the charge we expect and
     * tells Pesapal a recurring collection is authorised against Carevelo's own
     * account, returning the page the clinic's administrator pays on.
     *
     * A clinic's own Pesapal account is not reachable from here in any way.
     * SubscriptionBilling takes a PlatformMerchant, which can only produce
     * platform credentials from configuration; there is no AggregatorAccount in
     * scope and no query that could find one.
     *
     * 503 when the platform is unconfigured, which is the honest answer on a
     * deployment with no merchant account: it must never silently fall back to
     * collecting through a clinic's.
     */
    public function collect(Tenant $tenant, SubscriptionBilling $billing): JsonResponse
    {
        $this->authorize('update', $tenant);

        try {
            $handoff = $billing->start($tenant);
        } catch (AggregatorUnavailable $e) {
            return ProblemDetails::make(
                503,
                'billing_unavailable',
                'Subscription billing is unavailable',
                // PesapalClient and SubscriptionBilling construct these messages
                // and never put a credential in one.
                $e->getMessage(),
            );
        }

        $this->audit->record(
            'platform.subscription_collection_started',
            subjectType: 'Tenant',
            subjectId: $tenant->id,
            metadata: ['aggregator_tracking_id' => $handoff->trackingId],
        );

        return new JsonResponse(['data' => [
            'redirect_url' => $handoff->redirectUrl,
            'aggregator_tracking_id' => $handoff->trackingId,
        ]], 201);
    }

    /**
     * @return Collection<int, PlatformSubscriptionCharge>
     */
    private function recentCharges(Tenant $tenant): Collection
    {
        return PlatformSubscriptionCharge::query()
            ->where('tenant_id', $tenant->id)
            ->orderByDesc('initiated_at')
            ->limit(self::RECENT_CHARGES)
            ->get();
    }
}
