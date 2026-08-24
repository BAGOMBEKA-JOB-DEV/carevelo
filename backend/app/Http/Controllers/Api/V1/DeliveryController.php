<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Events\DeliveryAssigned;
use App\Http\Controllers\Api\V1\Concerns\AuthorisesPatientReads;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Deliveries\AssignRiderRequest;
use App\Http\Requests\V1\Deliveries\DispatchBoardRequest;
use App\Http\Requests\V1\Deliveries\StoreDeliveryRequest;
use App\Http\Resources\V1\DeliveryResource;
use App\Http\Resources\V1\PatientDeliveryResource;
use App\Models\Delivery;
use App\Models\DeliveryStatus;
use App\Models\DispenseOrder;
use App\Models\DispenseOrderStatus;
use App\Models\User;
use App\Support\Consent\DeliveryDisclosure;
use App\Support\ReferenceGenerator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;

/**
 * The dispatch board — the clinic's own view of deliveries in flight.
 *
 * Carevelo dispatches and tracks. It operates no fleet, holds no medicine and
 * hands nothing over; the rider is the clinic's own arrangement. Everything
 * here is a work item and a status.
 *
 * The rider's own surface is RiderDeliveryController, deliberately separate,
 * with its own resource class carrying no clinical fields. Do not merge them:
 * a shared controller is one forgotten conditional away from serving a
 * dispatcher payload to a rider.
 *
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md §5
 * @see docs/50-security-compliance/rbac-matrix.md
 */
class DeliveryController extends Controller
{
    use AuthorisesPatientReads;

    public function __construct(
        private readonly AuditLog $audit,
        private readonly ReferenceGenerator $references,
        private readonly DeliveryDisclosure $disclosure,
    ) {}

    /**
     * Two listings behind one route: the dispatch board, and the patient's own
     * deliveries.
     *
     * ==================================================================
     * WHY THE PATIENT BRANCH EXISTS AT ALL
     * ==================================================================
     *
     * `DeliveryPolicy::viewOwn()` has admitted a patient since it was written and
     * nothing called it, so a patient could `track` a delivery only if they
     * ALREADY held its identifier — and nothing they were allowed to call ever
     * handed them one. The whole journey of watching a package therefore had no
     * entry point in the portal: it opened from a link the clinic sent, or not at
     * all. This is that entry point.
     *
     * ==================================================================
     * THE PROJECTION IS THE DECISION, NOT THE QUERY
     * ==================================================================
     *
     * `authoriseListing()` guarantees the patient branch returns only rows that
     * reach one of this account's own patient records. What it cannot decide is
     * what a row SAYS, and `DeliveryResource` — the dispatcher's projection —
     * carries the recipient block, the street address, the landmark, the rider
     * and `failure_reason`. Serving that to a patient would quietly widen
     * `track` into `view`, which `DeliveryPolicy` splits on purpose.
     *
     * So the patient branch renders `PatientDeliveryResource`: the TRACKING
     * shape, which is milestones rather than contents, and which that class
     * argues field by field. The two projections are two classes rather than one
     * class with a conditional, for the same reason the rider has his own.
     *
     * WHY THE GATE IS ASKED TWICE. `authoriseListing()` decides authorisation and
     * narrowing together — deliberately, so neither can be had without the other
     * — and hands back a builder, not a verdict. The line below asks a DIFFERENT
     * question of the same gate: not "may this caller list?" but "which of the
     * two audiences is this?". Reading a flag off the trait would make the
     * projection look like a by-product of the authorisation; asking plainly
     * makes it a decision somebody wrote down.
     *
     * CURSOR FOR THE PATIENT, OFFSET STILL FOR THE BOARD, AND THAT ASYMMETRY IS
     * TEMPORARY AND DELIBERATE. The house rule is cursor pagination, and the new
     * listing gets it from its first day. The board keeps `paginate()` because
     * `meta.total` is what the clinic console reads to warn a pharmacist that a
     * lane holds more work than one page can carry, and `cursorPaginate()` does
     * not produce a total. Moving the board is the right change and it is a
     * change to those screens as well as to this line, which this one does not
     * own; see `apps/clinic-console/src/domains/delivery/api/deliveries.ts`,
     * which already says it is sending an offset under protest.
     */
    public function index(DispatchBoardRequest $request): AnonymousResourceCollection
    {
        $user = $request->user();

        // Asked BEFORE the authorising call, so a caller who is neither staff nor
        // a patient is refused there rather than falling through to a projection.
        $isStaff = $user !== null && $user->can('viewAny', Delivery::class);

        $query = $this->authoriseListing(Delivery::query(), $user, Delivery::class);

        $status = $request->statusFilter();

        if ($status !== null) {
            $query->where('status', $status->value);
        }

        if (! $isStaff) {
            /*
             * NEWEST FIRST, WHICH IS THE OPPOSITE OF THE BOARD BELOW, because the
             * two are different objects. The board is a work queue and the oldest
             * item is the one somebody is waiting on; this is a person's own
             * history, and the delivery they came to look at is almost always the
             * last one. The id tiebreak keeps the cursor stable when two are
             * dispatched in the same second.
             *
             * `rider_id` IS NOT FILTERABLE HERE. It is a dispatch-board control,
             * the patient projection names no rider, and a filter a caller can
             * send but never see the effect of is an invitation to probe with it.
             *
             * THE EVENTS ARE EAGER-LOADED because `PatientDeliveryResource`
             * renders the milestone thread for every row, and loading it lazily
             * would turn one page of deliveries into twenty-six queries.
             */
            $own = $query
                ->with('events')
                ->orderByDesc('created_at')
                ->orderByDesc('id')
                ->cursorPaginate($request->perPage());

            return PatientDeliveryResource::collection($own);
        }

        $riderId = $request->riderFilter();

        if ($riderId !== null) {
            $query->where('rider_id', $riderId);
        }

        // Oldest first. A dispatch board is a work queue, and the delivery that
        // has been waiting longest is the one a patient is wondering about.
        $deliveries = $query->orderBy('created_at')->paginate($request->perPage());

        return DeliveryResource::collection($deliveries);
    }

    /**
     * Dispatch a dispensed order.
     *
     * Two refusals live here and neither has an override:
     *
     *   1. an order holding a controlled item never enters the delivery flow
     *      (NDPA Act Cap 206) — enforced by Delivery::createFor();
     *   2. an address is never prepared for a rider without the patient's
     *      delivery_disclosure consent (DPPA 2019).
     */
    public function store(StoreDeliveryRequest $request): JsonResponse
    {
        // DeliveryPolicy exposes no `create` ability: the board IS the creation
        // surface, and the RBAC matrix grants creation to exactly the roles that
        // may see it — admin, pharmacist, dispatcher.
        $this->authorize('viewAny', Delivery::class);

        $order = DispenseOrder::query()->findOrFail($request->dispenseOrderId());

        $this->assertAddressMayBeDisclosed($order);

        $delivery = DB::transaction(function () use ($order, $request): Delivery {
            // createFor() refuses a controlled order before anything is written.
            // Running inside the transaction means the refusal also unwinds the
            // reference number this would otherwise have consumed.
            $delivery = Delivery::createFor($order, [
                'reference' => $this->references->next('DLV'),
                ...$request->recipient(),
            ]);

            // dispensed → out_for_delivery. Any other starting state throws:
            // nothing leaves the pharmacy before a named pharmacist has
            // dispensed it.
            $order->transitionTo(DispenseOrderStatus::OutForDelivery);

            // Identifiers and outcome only. What is in the package is not the
            // audit log's business and never will be.
            $this->audit->record('delivery.created', 'Delivery', $delivery->id, [
                'dispense_order_id' => $order->id,
            ]);

            return $delivery;
        });

        return DeliveryResource::make($delivery)->response()->setStatusCode(201);
    }

    public function show(Delivery $delivery): DeliveryResource
    {
        $this->authorize('view', $delivery);

        event(DeliveryAssigned::from($delivery));

        return DeliveryResource::make($delivery);
    }

    /**
     * Hand the delivery to a named rider.
     *
     * Dispatcher and administrator only — a rider does not assign work, to
     * themselves or to anyone else.
     */
    public function assign(AssignRiderRequest $request, Delivery $delivery): DeliveryResource
    {
        $this->authorize('assign', $delivery);

        $order = DispenseOrder::query()->findOrFail($delivery->dispense_order_id);

        // Checked again at the moment of assignment, not only at creation.
        // This is the instant the address actually reaches a rider, and consent
        // may have been withdrawn in between.
        $this->assertAddressMayBeDisclosed($order);

        $actor = $request->user();
        $actorId = $actor instanceof User ? $actor->id : null;

        DB::transaction(function () use ($delivery, $request, $actorId): void {
            // Reassignment is legitimate and expected: a rider goes unreachable
            // mid-delivery, or a failed delivery is sent out again after
            // returning to the pharmacy. Standing the delivery down first keeps
            // the original assignment in the event history rather than
            // overwriting it.
            if (in_array($delivery->status, [DeliveryStatus::Assigned, DeliveryStatus::ReturnedToPharmacy], true)) {
                $delivery->transitionTo(DeliveryStatus::Unassigned, $actorId);
            }

            $delivery->assignTo($request->riderId(), $actorId);

            $this->audit->record('delivery.assigned', 'Delivery', $delivery->id, [
                'rider_id' => $request->riderId(),
            ]);
        });

        return DeliveryResource::make($delivery);
    }

    /**
     * The patient's tracking view: status milestones and nothing else.
     *
     * MILESTONES ONLY. No recipient block, no address, no order contents, no
     * event note. A patient watching a package knows what they ordered; this
     * endpoint is read on shared phones and over shoulders, and the least it
     * discloses the better.
     *
     * @see docs/50-security-compliance/data-protection-dppa.md
     */
    public function tracking(Request $request, Delivery $delivery): JsonResponse
    {
        // track, not view. The patient waiting for this delivery may follow its
        // progress without gaining the record itself, which names an address and
        // hangs off an order full of medicines.
        $this->authorize('track', $delivery);

        /*
         * BUILT FROM THE LISTING'S PROJECTION PLUS EXACTLY ONE FIELD, and the
         * one field is the whole difference between the two screens.
         *
         * The payload used to be assembled by hand here, which meant the rule
         * "what may a patient read off a delivery" had two implementations — and
         * the second one, the listing, did not exist yet. Now there is one, in
         * `PatientDeliveryResource`, and this endpoint is that shape with
         * `failure_reason` added.
         *
         * WHY THE REASON IS ADDED HERE AND NOT THERE. A list is read at a glance
         * and often not by the person it belongs to; "refused" against a row is a
         * statement about a household, legible to anyone holding the phone. One
         * delivery, opened deliberately, is a different act — and it is the
         * screen that can put the clinic's telephone number beside the reason so
         * it leads somewhere. See the resource's own field-by-field argument.
         */
        return new JsonResponse([
            'data' => [
                ...PatientDeliveryResource::make($delivery)->toArray($request),
                'failure_reason' => $delivery->failure_reason,
            ],
        ]);
    }

    /**
     * Refuse to prepare an address for a rider without the patient's consent.
     *
     * The check itself lives in DeliveryDisclosure because the pharmacy asks the
     * same question one step earlier, when the patient chooses delivery as the
     * fulfilment method. Two copies could disagree, and an order accepted at the
     * counter and then refused at dispatch is a patient sent home twice.
     */
    private function assertAddressMayBeDisclosed(DispenseOrder $order): void
    {
        $this->disclosure->assertGrantedFor((string) $order->getAttribute('patient_id'));
    }
}
