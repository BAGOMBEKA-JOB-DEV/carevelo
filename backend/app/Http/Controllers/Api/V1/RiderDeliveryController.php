<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Events\DeliveryDelivered;
use App\Events\DeliveryFailed;
use App\Http\Controllers\Controller;
use App\Http\Resources\V1\RiderDeliveryResource;
use App\Models\Delivery;
use App\Models\DeliveryStatus;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\ValidationException;

/**
 * The rider's surface.
 *
 * A SEPARATE controller and a separate resource class, not the dispatcher's
 * with fields hidden. Riders see only their own assignments and only the
 * minimum data needed to hand over a package.
 *
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md
 */
class RiderDeliveryController extends Controller
{
    public function __construct(protected AuditLog $audit) {}

    /**
     * Only the authenticated rider's own assignments.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        $deliveries = Delivery::query()
            ->where('rider_id', $request->user()?->id)
            ->whereIn('status', [
                DeliveryStatus::Assigned,
                DeliveryStatus::PickedUp,
                DeliveryStatus::EnRoute,
            ])
            ->orderBy('assigned_at')
            ->cursorPaginate(25);

        return RiderDeliveryResource::collection($deliveries);
    }

    public function show(Request $request, Delivery $delivery): RiderDeliveryResource
    {
        $this->authorize('updateStatus', $delivery);

        return new RiderDeliveryResource($delivery);
    }

    /**
     * Advance the delivery status.
     *
     * The transition itself is validated by the state machine, so an illegal
     * move throws rather than silently writing a nonsense status.
     */
    public function updateStatus(Request $request, Delivery $delivery): RiderDeliveryResource
    {
        $this->authorize('updateStatus', $delivery);

        $validated = $request->validate([
            'status' => ['required', 'string'],
            'failure_reason' => ['required_if:status,failed', 'string'],
        ]);

        $status = DeliveryStatus::tryFrom($validated['status'])
            ?? throw ValidationException::withMessages([
                'status' => 'That is not a delivery status.',
            ]);

        if ($status === DeliveryStatus::Failed) {
            $delivery->fail($validated['failure_reason'], $request->user()?->id);
        } else {
            $delivery->transitionTo($status, $request->user()?->id);
        }

        $this->audit->record(
            'delivery.'.$status->value,
            subjectType: 'Delivery',
            subjectId: $delivery->id,
        );

        // The dispatch board and the patient's tracking view both update from
        // here. Both events need the order for the patient identifier, which
        // decides WHERE the frame goes -- never what it says.
        $order = $delivery->dispenseOrder;

        if ($order !== null) {
            match ($status) {
                DeliveryStatus::Delivered => event(DeliveryDelivered::from($delivery, $order)),
                DeliveryStatus::Failed => event(DeliveryFailed::from($delivery, $order)),
                default => null,
            };
        }

        return new RiderDeliveryResource($delivery);
    }
}
