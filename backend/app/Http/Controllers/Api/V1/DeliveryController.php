<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Events\DeliveryAssigned;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Deliveries\AssignRiderRequest;
use App\Http\Requests\V1\Deliveries\DispatchBoardRequest;
use App\Http\Requests\V1\Deliveries\StoreDeliveryRequest;
use App\Http\Resources\V1\DeliveryResource;
use App\Models\Delivery;
use App\Models\DeliveryEvent;
use App\Models\DeliveryStatus;
use App\Models\DispenseOrder;
use App\Models\DispenseOrderStatus;
use App\Models\User;
use App\Support\Consent\DeliveryDisclosure;
use App\Support\ReferenceGenerator;
use Carbon\CarbonInterface;
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
    public function __construct(
        private readonly AuditLog $audit,
        private readonly ReferenceGenerator $references,
        private readonly DeliveryDisclosure $disclosure,
    ) {}

    /** The dispatch board. */
    public function index(DispatchBoardRequest $request): AnonymousResourceCollection
    {
        $this->authorize('viewAny', Delivery::class);

        $query = Delivery::query();

        $status = $request->statusFilter();

        if ($status !== null) {
            $query->where('status', $status->value);
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
        $this->authorize('view', $delivery);

        $milestones = $delivery->events()
            ->orderBy('occurred_at')
            ->get()
            ->map(function (DeliveryEvent $event): array {
                $occurredAt = $event->getAttribute('occurred_at');

                // to_status and a timestamp. The `note` column is deliberately
                // not read here: it is free text, and free text is where
                // clinical content escapes.
                return [
                    'status' => $event->to_status,
                    'occurred_at' => $occurredAt instanceof CarbonInterface
                        ? $occurredAt->toIso8601String()
                        : null,
                ];
            })
            ->all();

        return new JsonResponse([
            'data' => [
                'id' => $delivery->id,
                'reference' => $delivery->reference,
                'status' => $delivery->status->value,
                'failure_reason' => $delivery->failure_reason,
                'assigned_at' => $delivery->assigned_at?->toIso8601String(),
                'delivered_at' => $delivery->delivered_at?->toIso8601String(),
                'milestones' => $milestones,
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
