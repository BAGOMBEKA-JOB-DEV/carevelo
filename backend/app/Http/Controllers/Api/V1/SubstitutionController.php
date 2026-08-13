<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Events\SubstitutionApproved;
use App\Events\SubstitutionProposed;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Dispensing\StoreSubstitutionRequest;
use App\Http\Resources\V1\SubstitutionResource;
use App\Models\Clinician;
use App\Models\DispenseOrder;
use App\Models\DispenseOrderStatus;
use App\Models\Substitution;
use App\Models\SubstitutionStatus;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\Response;

/**
 * Proposing, and deciding on, a different item from the one prescribed.
 *
 * The separation of the two is the entire point. A pharmacist PROPOSES; a
 * clinician DECIDES. A substitution is a clinical decision and never a
 * pharmacist's unilateral one, so the propose and decide abilities sit on
 * different policy methods held by different roles — the pharmacist who
 * proposed cannot approve their own proposal, and neither can an administrator.
 *
 * There is no auto-approval and no timeout that grants one. A clinician who
 * cannot be reached leaves the order holding, and the patient is offered a
 * partial fill or a wait. That is a worse user experience and the only
 * defensible behaviour.
 *
 * A substitution is never an edit to the prescription. The prescription is a
 * clinical document and is not touched here or anywhere else.
 *
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md — out of stock
 */
class SubstitutionController extends Controller
{
    public function __construct(private readonly AuditLog $audit) {}

    /**
     * A pharmacist proposes a substitute, and the affected item blocks.
     *
     * Only that item. The order moves to awaiting_substitution, from which the
     * remaining items can still be priced — one out-of-stock line must not
     * stall the whole order, or pharmacists work around the system instead of
     * with it.
     */
    public function store(
        StoreSubstitutionRequest $request,
        DispenseOrder $dispenseOrder,
    ): JsonResponse {
        $this->authorize('create', Substitution::class);

        $proposer = $request->user();

        if (! $proposer instanceof User) {
            throw new IllegalTransition('A substitution must be proposed by a named pharmacist of this clinic.');
        }

        $prescription = $dispenseOrder->prescription()->firstOrFail();

        // The item must be on THIS order's prescription. Without this a
        // pharmacist could attach a proposal to another patient's item, and the
        // composite foreign key would happily accept it within the tenant.
        $itemBelongs = $prescription->items()
            ->whereKey($request->prescriptionItemId())
            ->exists();

        if (! $itemBelongs) {
            throw new IllegalTransition('That item is not on this order\'s prescription.');
        }

        $substitution = DB::transaction(function () use ($request, $dispenseOrder, $proposer): Substitution {
            $substitution = Substitution::create([
                'dispense_order_id' => $dispenseOrder->id,
                'prescription_item_id' => $request->prescriptionItemId(),
                'proposed_medicine_name' => $request->proposedMedicineName(),
                'reason' => $request->reason(),
                'proposed_by' => $proposer->id,
                'proposed_at' => Date::now(),
                'status' => SubstitutionStatus::Pending,
            ]);

            // under_review → awaiting_substitution. Proposing against an order
            // that is already dispensed is an IllegalTransition, rendered 409.
            $dispenseOrder->transitionTo(DispenseOrderStatus::AwaitingSubstitution);

            // Identifiers only. The proposed medicine name is the substance of
            // the proposal and stays on the record, out of the audit trail.
            $this->audit->record('substitution.proposed', 'Substitution', $substitution->id, [
                'dispense_order_id' => $dispenseOrder->id,
                'prescription_item_id' => $request->prescriptionItemId(),
            ]);

            return $substitution;
        });

        // The prescribing clinician is the one who must decide, so the frame is
        // addressed to their own channel rather than a role channel — a
        // proposal is not everyone's business.
        //
        // THE PROPOSED MEDICINE NAME IS NOT ON THE WIRE. The clinician fetches
        // it from the API, where the policy runs.
        $clinicianUserId = $this->prescribingClinicianUserId($prescription->getAttribute('clinician_id'));

        if ($clinicianUserId !== null) {
            event(SubstitutionProposed::from($substitution, $dispenseOrder, $clinicianUserId));
        }

        return SubstitutionResource::make($substitution)
            ->response()
            ->setStatusCode(Response::HTTP_CREATED);
    }

    /** Approve. Clinician only — enforced by SubstitutionPolicy::decide. */
    public function approve(Request $request, Substitution $substitution): SubstitutionResource
    {
        return $this->decide($request, $substitution, SubstitutionStatus::Approved);
    }

    /**
     * Reject. The item is then filled as unfulfilled with a reason, and the
     * patient is offered a partial fill — it is not silently dropped.
     */
    public function reject(Request $request, Substitution $substitution): SubstitutionResource
    {
        return $this->decide($request, $substitution, SubstitutionStatus::Rejected);
    }

    /**
     * The clinician's decision, recorded against them by name.
     *
     * Deciding twice is an IllegalTransition from the state machine: approved
     * and rejected are both terminal, so an approval cannot later be quietly
     * reversed into a rejection.
     */
    private function decide(Request $request, Substitution $substitution, SubstitutionStatus $outcome): SubstitutionResource
    {
        $this->authorize('decide', $substitution);

        $decider = $request->user();

        if (! $decider instanceof User) {
            throw new IllegalTransition('A substitution must be decided by a named clinician of this clinic.');
        }

        $order = DispenseOrder::query()->findOrFail($substitution->dispense_order_id);

        DB::transaction(function () use ($substitution, $decider, $outcome): void {
            $outcome === SubstitutionStatus::Approved
                ? $substitution->approve($decider->id)
                : $substitution->reject($decider->id);

            $this->audit->record('substitution.decided', 'Substitution', $substitution->id, [
                'dispense_order_id' => $substitution->dispense_order_id,
                'outcome' => $outcome->value,
            ]);
        });

        // The pharmacy is told a decision exists; what was substituted for what
        // comes from the API. The same event carries either outcome, because a
        // separate rejection class would have an identical payload.
        event(SubstitutionApproved::from($substitution, $order));

        return SubstitutionResource::make($substitution);
    }

    /**
     * The user behind the prescribing clinician, if they still have one.
     *
     * Null is a real possibility rather than an oversight: a clinician may have
     * left the tenant since issuing the prescription. The snapshot on the
     * prescription keeps the document intact, but there is no longer anyone to
     * address the frame to, and the proposal simply waits in the queue to be
     * picked up by whoever is on duty.
     */
    private function prescribingClinicianUserId(mixed $clinicianId): ?string
    {
        if (! is_string($clinicianId)) {
            return null;
        }

        $clinician = Clinician::query()->find($clinicianId);

        if (! $clinician instanceof Clinician) {
            return null;
        }

        $userId = $clinician->getAttribute('user_id');

        return is_string($userId) ? $userId : null;
    }
}
