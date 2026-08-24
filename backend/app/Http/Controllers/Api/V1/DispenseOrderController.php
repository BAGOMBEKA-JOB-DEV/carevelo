<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Events\OrderDispensed;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Http\Controllers\Api\V1\Concerns\AuthorisesPatientReads;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Dispensing\IndexDispenseOrderRequest;
use App\Http\Requests\V1\Dispensing\PriceDispenseOrderRequest;
use App\Http\Requests\V1\Dispensing\RecordFulfilmentRequest;
use App\Http\Requests\V1\Dispensing\RejectDispenseOrderRequest;
use App\Http\Resources\V1\DispenseOrderResource;
use App\Models\DispenseItem;
use App\Models\DispenseOrder;
use App\Models\DispenseOrderStatus;
use App\Models\Substitution;
use App\Models\SubstitutionStatus;
use App\Models\User;
use App\Support\Consent\DeliveryDisclosure;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * The pharmacy bench.
 *
 * Every action here belongs to the clinic's own NDA-licensed pharmacy under the
 * NDPA Act Cap 206. Carevelo routes a work item and records a status: it holds
 * no stock, sets no price, takes no margin, and hands nothing to anyone.
 *
 * Nothing in this controller touches the Prescription. That is why DispenseOrder
 * is a separate aggregate — what was PRESCRIBED and what was DISPENSED are
 * different facts, and a partial fill or a substitution is only legible later if
 * both survive independently.
 *
 * Opening, pricing and rejecting are the same authorisation question — may this
 * user work this order at the bench? — so they share a role set. `dispense` and
 * `collect` are narrower: both are moments medicine physically moves, and only a
 * pharmacist may record one, never an administrator. `chooseFulfilment` is wider
 * instead, because the front desk takes that call too.
 *
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md
 */
class DispenseOrderController extends Controller
{
    use AuthorisesPatientReads;

    public function __construct(
        private readonly AuditLog $audit,
        private readonly DeliveryDisclosure $disclosure,
    ) {}

    /**
     * Two listings behind one route: the pharmacy queue, and the patient's own
     * orders.
     *
     * Medicine names are deliberately absent from BOTH: the prescription
     * relation is not loaded, so the listing is references, states and money. A
     * pharmacist scanning for work does not need the contents, and this is the
     * most-displayed screen in the pharmacy.
     *
     * ==================================================================
     * WHY THE PATIENT BRANCH EXISTS AT ALL
     * ==================================================================
     *
     * `DispenseOrderPolicy::viewOwn()` has admitted a patient since it was
     * written and nothing called it, so a patient could open a dispense order
     * only if they ALREADY held its identifier — and nothing they were allowed to
     * call ever handed them one. Paying for a dispensed order and choosing
     * collection or delivery therefore had no entry point in the portal at all:
     * both opened from a link the clinic sent, or not at all. This is that entry
     * point.
     *
     * ==================================================================
     * THE ONE FIELD THAT CHANGES BETWEEN THE TWO AUDIENCES
     * ==================================================================
     *
     * `substitutions` IS LOADED FOR STAFF ONLY, and the reason is that
     * `SubstitutionResource` publishes `proposed_medicine_name` — correctly, for
     * a clinician who cannot decide on a substitution without knowing what is
     * being proposed. Loading it for a patient would put a medicine name in a
     * LIST, on the surface this controller's own docblock says is kept free of
     * them, read on shared handsets and over shoulders. It is not withheld from
     * the patient as a fact: the order's own screen, reached by opening one row
     * deliberately, is behind `view` and carries the whole prescription.
     *
     * Nothing else differs, so there is one resource class rather than two —
     * `DispenseOrderResource` already gates the relation behind `whenLoaded()`,
     * so the field is ABSENT from a patient's payload rather than blanked, which
     * is the distinction the rider resource argues at length.
     *
     * CURSOR FOR THE PATIENT, OFFSET STILL FOR THE QUEUE. The house rule is
     * cursor pagination and the new listing gets it from its first day. The queue
     * keeps `paginate()` because the clinic console reads `meta.total` to warn a
     * pharmacist that a lane holds more orders than one page can carry, and
     * `cursorPaginate()` produces no total; moving it is a change to those
     * screens as well as to this line, and this change does not own them. See
     * `apps/clinic-console/src/domains/dispensing/api/queue.ts`, which already
     * says it is sending an offset under protest.
     */
    public function index(IndexDispenseOrderRequest $request): AnonymousResourceCollection
    {
        $user = $request->user();

        // Asked BEFORE the authorising call, so a caller who is neither staff nor
        // a patient is refused there rather than falling through to a projection.
        $isStaff = $user !== null && $user->can('viewAny', DispenseOrder::class);

        // Authorises AND narrows: a patient gets only orders belonging to the
        // patient records their account owns. The patient_id filter below then
        // intersects with that, so passing someone else's id returns nothing
        // rather than their orders.
        $query = $this->authoriseListing(DispenseOrder::query(), $user, DispenseOrder::class);

        if ($isStaff) {
            $query->with('substitutions');
        }

        $status = $request->status();

        if ($status !== null) {
            $query->where('status', $status->value);
        }

        $patientId = $request->patientId();

        if ($patientId !== null) {
            $query->where('patient_id', $patientId);
        }

        if ($isStaff) {
            // Oldest first. A queue is a work list, and the order that has waited
            // longest is the patient sitting in the pharmacy wondering.
            $orders = $query->orderBy('created_at')->orderBy('id')->paginate($request->perPage());
        } else {
            // Newest first, because this is a person's own history rather than a
            // work queue: the order they came to look at is almost always the
            // last one. The id tiebreak keeps the cursor stable when two orders
            // are created in the same second.
            $orders = $query
                ->orderByDesc('created_at')
                ->orderByDesc('id')
                ->cursorPaginate($request->perPage());
        }

        // Reads of clinical records are audited as well as writes: "who looked at
        // my records?" can only be answered by having recorded every look.
        // Identifiers and a count — never what is on the order.
        $this->audit->record('dispense_order.list_read', metadata: [
            'patient_id' => $patientId,
            'returned' => $orders->count(),
        ]);

        return DispenseOrderResource::collection($orders);
    }

    /**
     * The order in full, including what was prescribed.
     *
     * This is the one place a medicine name is meant to be read, and it is
     * behind the policy. The read is audited: "who looked at my records?" can
     * only be answered by having recorded every look.
     */
    public function show(DispenseOrder $dispense_order): DispenseOrderResource
    {
        $this->authorize('view', $dispense_order);

        $this->audit->record('dispense_order.read', 'DispenseOrder', $dispense_order->id);

        return DispenseOrderResource::make(
            $dispense_order->load(['items', 'substitutions', 'prescription.items'])
        );
    }

    /** Take the order to the bench: received → under_review. */
    public function open(DispenseOrder $dispenseOrder): DispenseOrderResource
    {
        $this->authorize('open', $dispenseOrder);

        // Opening an order twice is an IllegalTransition, rendered as 409.
        $dispenseOrder->transitionTo(DispenseOrderStatus::UnderReview);

        $this->audit->record('dispense_order.opened', 'DispenseOrder', $dispenseOrder->id);

        return DispenseOrderResource::make($dispenseOrder->load('items'));
    }

    /**
     * Price the order at the clinic's own prices, recording what will be filled.
     *
     * Four refusals live here, and each one is the reason this endpoint is not
     * a simple write:
     *
     *   1. an item that is not on the prescription cannot be priced;
     *   2. every prescribed item must be accounted for — filled, or explicitly
     *      unfulfilled with a reason. Silence is not an option, because a
     *      silently dropped line is a medicine the patient never learns they
     *      did not get;
     *   3. an item with a PENDING substitution blocks — only that item, never
     *      the rest of the order;
     *   4. a substitute may only be filled against an APPROVED substitution.
     *      This is the control that makes clinician approval real rather than
     *      advisory.
     */
    public function price(PriceDispenseOrderRequest $request, DispenseOrder $dispenseOrder): DispenseOrderResource
    {
        $this->authorize('price', $dispenseOrder);

        $items = $request->items();

        $prescription = $dispenseOrder->prescription()->firstOrFail();

        /** @var Collection<int, string> $prescribedItemIds */
        $prescribedItemIds = $prescription->items()->pluck('id');

        /** @var Collection<string, Substitution> $substitutions */
        $substitutions = $dispenseOrder->substitutions()->get()->keyBy('id');

        $this->assertItemsMatchPrescription($items, $prescribedItemIds);

        foreach ($items as $item) {
            $this->assertItemIsNotBlocked($item, $substitutions);
            $this->assertSubstituteWasApproved($item, $substitutions);
        }

        DB::transaction(function () use ($dispenseOrder, $items, $request): void {
            // Repricing replaces rather than accumulates: price() is reachable
            // again after a substitution is decided, and a second pass must not
            // leave the first pass's lines behind to be charged twice.
            $dispenseOrder->items()->delete();

            $subtotalMinor = 0;

            foreach ($items as $item) {
                DispenseItem::create([
                    'dispense_order_id' => $dispenseOrder->id,
                    ...$item,
                ]);

                // An unfulfilled line is recorded but never charged for.
                if ($item['is_fulfilled']) {
                    $subtotalMinor += $item['unit_price_minor'] * $item['quantity_dispensed'];
                }
            }

            $deliveryFeeMinor = $request->deliveryFeeMinor();

            $dispenseOrder->subtotal_minor = $subtotalMinor;
            $dispenseOrder->delivery_fee_minor = $deliveryFeeMinor;
            $dispenseOrder->total_minor = $subtotalMinor + $deliveryFeeMinor;

            // A partial fill is a different state from a complete one, and the
            // state machine only permits it from awaiting_substitution — an
            // order that never had a substitution cannot arrive at a partial
            // fill, and attempting it is a 409 rather than a silent downgrade.
            $anyUnfulfilled = array_filter($items, static fn (array $i): bool => ! $i['is_fulfilled']) !== [];

            $dispenseOrder->transitionTo(
                $anyUnfulfilled ? DispenseOrderStatus::PartiallyPriced : DispenseOrderStatus::Priced
            );

            // Amounts and counts are outcomes, and belong here. Medicine names
            // are content, and never do.
            $this->audit->record('dispense_order.priced', 'DispenseOrder', $dispenseOrder->id, [
                'item_count' => count($items),
                'unfulfilled_count' => count(array_filter($items, static fn (array $i): bool => ! $i['is_fulfilled'])),
                'total_minor' => $dispenseOrder->total_minor,
                'currency' => $dispenseOrder->currency,
            ]);
        });

        return DispenseOrderResource::make($dispenseOrder->load(['items', 'substitutions']));
    }

    /**
     * Hand the medicine over, against a NAMED pharmacist of this clinic.
     *
     * The pharmacist is the authenticated user, never a body field: accepting
     * an identity from the request would let one member of staff dispense in
     * another's name, and attribution is the whole point of the record.
     *
     * DispenseOrder::dispense() refuses while any substitution is still
     * pending, so an unapproved substitute cannot leave the pharmacy.
     */
    public function dispense(Request $request, DispenseOrder $dispenseOrder): DispenseOrderResource
    {
        $this->authorize('dispense', $dispenseOrder);

        $pharmacist = $request->user();

        if (! $pharmacist instanceof User) {
            throw new IllegalTransition('Dispensing must be recorded against a named pharmacist of this clinic.');
        }

        DB::transaction(function () use ($dispenseOrder, $pharmacist): void {
            $dispenseOrder->dispense($pharmacist->id);

            $this->audit->record('dispense_order.dispensed', 'DispenseOrder', $dispenseOrder->id, [
                'pharmacist_id' => $pharmacist->id,
            ]);
        });

        // Dispatched AFTER the transaction commits, never inside it: a frame
        // announcing a dispense that then rolls back is a pharmacy screen
        // showing something that did not happen.
        //
        // Identifiers and state only. The frame tells the pharmacy screen and
        // the patient's device to go and re-fetch; it never says what was in
        // the bag.
        event(OrderDispensed::from($dispenseOrder));

        return DispenseOrderResource::make($dispenseOrder->load('items'));
    }

    /**
     * Record whether the patient is collecting or having it delivered.
     *
     * Two refusals live here, and both exist so that the answer given at the
     * counter is the same one dispatch will give later:
     *
     *   1. an order holding a controlled item can never be delivered (NDPA Act
     *      Cap 206). There is no override, and refusing at this point means the
     *      patient is told while they are still standing there rather than after
     *      they have gone home to wait;
     *   2. delivery requires the patient's delivery_disclosure consent to already
     *      be granted. This endpoint does not WRITE that consent -- capturing it
     *      needs the exact policy wording the patient read, and ConsentController
     *      owns that text and the hash taken over it. A second writer here would
     *      pin a hash to text it had reproduced by hand, which is precisely the
     *      failure the hash exists to catch.
     *
     * Choosing pickup on an already-dispensed order also readies it for
     * collection: the medicine is on the shelf with the patient's name on it,
     * which is what ready_for_pickup means. Delivery does not transition here,
     * because leaving the pharmacy needs a Delivery record and a rider -- that is
     * DeliveryController's job.
     */
    public function fulfilment(RecordFulfilmentRequest $request, DispenseOrder $dispenseOrder): DispenseOrderResource
    {
        $this->authorize('chooseFulfilment', $dispenseOrder);

        if ($request->wantsDelivery()) {
            if (! $dispenseOrder->mayBeDelivered()) {
                throw new IllegalTransition(
                    'This order contains a controlled medicine and must be collected in person. '
                    .'Controlled items are excluded from delivery and there is no override.'
                );
            }

            $this->disclosure->assertGrantedFor((string) $dispenseOrder->patient_id);
        }

        DB::transaction(function () use ($dispenseOrder, $request): void {
            $dispenseOrder->fulfilment = $request->method();
            $dispenseOrder->save();

            if (! $request->wantsDelivery() && $dispenseOrder->status === DispenseOrderStatus::Dispensed) {
                $dispenseOrder->transitionTo(DispenseOrderStatus::ReadyForPickup);
            }

            // The METHOD, not the address. Where someone lives is not an audit
            // event's business even when the audit event is about delivering to it.
            $this->audit->record('dispense_order.fulfilment_chosen', 'DispenseOrder', $dispenseOrder->id, [
                'method' => $request->method(),
                'status' => $dispenseOrder->status->value,
            ]);
        });

        return DispenseOrderResource::make($dispenseOrder->load('items'));
    }

    /**
     * The patient collected it at the pharmacy.
     *
     * Terminal, and deliberately narrower than it looks: an order set for
     * DELIVERY cannot be collected here. Marking a delivery collected would close
     * it while a rider still holds the package, and the tracking the patient is
     * watching would go quiet with their medicines still in transit.
     *
     * Accepts an order that is dispensed but was never explicitly readied --
     * ready_for_pickup is a shelf state, and a pharmacist who dispensed and handed
     * over in one motion did not skip a step, they did two at once. The walk
     * through ready_for_pickup is still made rather than jumped, so the state
     * machine records both.
     */
    public function collect(DispenseOrder $dispenseOrder): DispenseOrderResource
    {
        $this->authorize('collect', $dispenseOrder);

        if ($dispenseOrder->fulfilment === RecordFulfilmentRequest::DELIVERY) {
            throw new IllegalTransition(
                'This order is set for delivery. Complete it through the delivery, '
                .'or change the fulfilment method to pickup first.'
            );
        }

        DB::transaction(function () use ($dispenseOrder): void {
            if ($dispenseOrder->status === DispenseOrderStatus::Dispensed) {
                $dispenseOrder->transitionTo(DispenseOrderStatus::ReadyForPickup);
            }

            $dispenseOrder->transitionTo(DispenseOrderStatus::Collected);

            $this->audit->record('dispense_order.collected', 'DispenseOrder', $dispenseOrder->id);
        });

        return DispenseOrderResource::make($dispenseOrder->load('items'));
    }

    /**
     * The pharmacy declines to fill the order.
     *
     * The reason is recorded so the prescribing clinician is not left guessing,
     * and stays out of the audit event: a pharmacist explaining a refusal will
     * name the medicine, and an audit event records that something happened,
     * never what it said.
     */
    public function reject(RejectDispenseOrderRequest $request, DispenseOrder $dispenseOrder): DispenseOrderResource
    {
        $this->authorize('reject', $dispenseOrder);

        DB::transaction(function () use ($dispenseOrder, $request): void {
            $dispenseOrder->rejection_reason = $request->reason();
            $dispenseOrder->transitionTo(DispenseOrderStatus::Rejected);

            $this->audit->record('dispense_order.rejected', 'DispenseOrder', $dispenseOrder->id);
        });

        return DispenseOrderResource::make($dispenseOrder->load('items'));
    }

    /**
     * Every prescribed item accounted for, exactly once, and nothing invented.
     *
     * @param  list<array{prescription_item_id: string, ...}>  $items
     * @param  Collection<int, string>  $prescribedItemIds
     */
    private function assertItemsMatchPrescription(array $items, Collection $prescribedItemIds): void
    {
        $submitted = array_column($items, 'prescription_item_id');

        if (count($submitted) !== count(array_unique($submitted))) {
            throw new IllegalTransition('Each prescribed item may be priced only once.');
        }

        if (array_diff($submitted, $prescribedItemIds->all()) !== []) {
            throw new IllegalTransition('This order was priced against an item that is not on the prescription.');
        }

        if (array_diff($prescribedItemIds->all(), $submitted) !== []) {
            throw new IllegalTransition(
                'Every prescribed item must be priced or marked unfulfilled with a reason. '
                .'An item left out is one the patient is never told they did not receive.'
            );
        }
    }

    /**
     * A pending substitution blocks ITS OWN item and nothing else.
     *
     * The rest of the order prices normally. If one out-of-stock item stalled
     * everything, pharmacists would work around the system rather than with it.
     *
     * @param  array{prescription_item_id: string, is_fulfilled: bool, ...}  $item
     * @param  Collection<string, Substitution>  $substitutions
     */
    private function assertItemIsNotBlocked(array $item, Collection $substitutions): void
    {
        $pending = $substitutions->contains(
            fn (Substitution $substitution): bool => $substitution->prescription_item_id === $item['prescription_item_id']
                && $substitution->status === SubstitutionStatus::Pending
        );

        if ($pending && $item['is_fulfilled']) {
            throw new IllegalTransition(
                'This item is awaiting a clinician\'s decision on a proposed substitution '
                .'and cannot be filled yet. The other items on the order may be priced.'
            );
        }
    }

    /**
     * A substitute is filled only against an APPROVED substitution for that
     * same item.
     *
     * This is where clinician approval stops being advisory. Without it a
     * pharmacist could record any substitute they liked and the approval step
     * would be decoration.
     *
     * @param  array{prescription_item_id: string, substitution_id: ?string, ...}  $item
     * @param  Collection<string, Substitution>  $substitutions
     */
    private function assertSubstituteWasApproved(array $item, Collection $substitutions): void
    {
        $substitutionId = $item['substitution_id'];

        if ($substitutionId === null) {
            return;
        }

        $substitution = $substitutions->get($substitutionId);

        if (! $substitution instanceof Substitution) {
            throw new IllegalTransition('That substitution does not belong to this order.');
        }

        if ($substitution->prescription_item_id !== $item['prescription_item_id']) {
            throw new IllegalTransition('That substitution was approved for a different item.');
        }

        if ($substitution->status !== SubstitutionStatus::Approved) {
            throw new IllegalTransition(
                'A substitute may be dispensed only after a clinician has approved it. '
                .'There is no auto-approval.'
            );
        }
    }
}
