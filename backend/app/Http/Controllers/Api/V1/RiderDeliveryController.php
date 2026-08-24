<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Events\DeliveryDelivered;
use App\Events\DeliveryFailed;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Rider\RiderAssignmentsRequest;
use App\Http\Resources\V1\RiderDeliveryResource;
use App\Models\Delivery;
use App\Models\DeliveryStatus;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Date;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\NotFoundHttpException;

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
     * How far back a rider may read their own finished work.
     *
     * ==================================================================
     * THIS NUMBER IS A DISCLOSURE DECISION, NOT A CONVENIENCE
     * ==================================================================
     *
     * A rider is the least-trusted human actor in the system: often a contractor,
     * often paid per run, holding a personal phone that leaves the clinic every
     * evening and may be sold, lost or handed on. Every row this endpoint returns
     * carries a named person's telephone number and the street address where
     * their medicines were taken — and the fact that a named person received a
     * delivery from a named clinic is itself health data under DPPA 2019, whether
     * or not a medicine is named.
     *
     * An all-time history would therefore turn a rider's phone into a standing,
     * exportable list of a clinic's patients and where they live, growing for as
     * long as the account exists. Nothing in the job needs that. What the job
     * needs is the ability to check today's round against the clinic's record of
     * it, and to see the delivery that came back yesterday so it does not simply
     * vanish from the list.
     *
     * SEVENTY-TWO HOURS, and the number is chosen against those two uses rather
     * than picked round. It spans a full working day plus the day either side, so
     * a Saturday round is still readable on Monday and a Friday dispute does not
     * fall off the end of a weekend. It is short enough that a rider who leaves
     * the clinic's arrangement holds nothing readable within the working week,
     * and short enough that a lost handset is a bounded exposure rather than an
     * open-ended one.
     *
     * IT DOES NOT BOUND ACTIVE WORK. A delivery still assigned to this rider is
     * always visible however long it has been sitting there — a package that
     * disappeared from a rider's list because it aged out is a package nobody
     * delivers. The window applies to the `completed` filter alone.
     */
    private const COMPLETED_WINDOW_HOURS = 72;

    /**
     * Only the authenticated rider's own assignments.
     *
     * TWO ANSWERS, ONE FOR EACH TAB THE RIDER APP HAS: the round in front of them,
     * and what they finished recently. `RiderAssignmentsRequest` explains why the
     * parameter takes those two words rather than the seven-case delivery status
     * enum the dispatch board speaks.
     *
     * THE PAYLOAD IS THE SAME IN BOTH, AND IT IS `RiderDeliveryResource` — a
     * separate class with no clinical fields on it at all. Finished work does not
     * get a wider projection than live work; it gets a narrower window.
     *
     * NOTHING HERE FILTERS ON OWNERSHIP FROM THE REQUEST. `rider_id` comes from
     * the SESSION, so there is no query a client could write that returns another
     * rider's work — and no parameter below could be mistaken for the thing that
     * protects it.
     */
    public function index(RiderAssignmentsRequest $request): AnonymousResourceCollection
    {
        $query = Delivery::query()->where('rider_id', $request->user()?->id);

        if ($request->wantsCompleted()) {
            /*
             * `updated_at`, not `delivered_at`, because two of the three settled
             * states never set `delivered_at`: a failed delivery and one returned
             * to the pharmacy have no delivery time by definition, and filtering
             * on a null column would return an empty list for exactly the rows a
             * rider most needs to see. Every transition calls save(), so for a
             * settled delivery `updated_at` IS the moment it settled.
             *
             * Newest first here, where the active list is oldest first: a work
             * queue is read from the front, a record of what you just did is read
             * from the back.
             */
            $deliveries = $query
                ->whereIn('status', $this->settledStatuses())
                ->where('updated_at', '>=', Date::now()->subHours(self::COMPLETED_WINDOW_HOURS))
                ->orderByDesc('updated_at')
                ->orderByDesc('id')
                ->cursorPaginate($request->perPage());

            return RiderDeliveryResource::collection($deliveries);
        }

        $deliveries = $query
            ->whereIn('status', [
                DeliveryStatus::Assigned,
                DeliveryStatus::PickedUp,
                DeliveryStatus::EnRoute,
            ])
            ->orderBy('assigned_at')
            ->orderBy('id')
            ->cursorPaginate($request->perPage());

        return RiderDeliveryResource::collection($deliveries);
    }

    /**
     * One of the rider's own assignments — subject to the same window.
     *
     * WITHOUT THIS THE WINDOW ON THE LISTING WOULD BE COSMETIC. A rider who read
     * a delivery yesterday holds its identifier, and a `show` with no bound would
     * hand back the recipient, the telephone number and the address for as long
     * as the row exists. The listing decides what a rider may DISCOVER; this
     * decides what they may still READ, and the two have to agree or only the
     * weaker one is true.
     *
     * 404 RATHER THAN 403 for a delivery that has aged out, for the reason every
     * refusal on this surface is a 404: a rider must learn nothing from the
     * difference between "not yours" and "does not exist", and an address that is
     * no longer theirs to read is no longer theirs to be told about either.
     *
     * ACTIVE WORK IS NEVER AGED OUT, however long it has been sitting there. The
     * reconciliation read the rider app performs after a lost connection also
     * lands here, seconds after the transition it is checking, so it is never
     * near the edge of the window.
     */
    public function show(Request $request, Delivery $delivery): RiderDeliveryResource
    {
        $this->authorize('updateStatus', $delivery);

        $this->assertWithinDisclosureWindow($delivery);

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

    /**
     * The three states a delivery is finished in.
     *
     * Named once and read by both the listing and the single read, so "finished"
     * cannot come to mean two different things in the same controller. A failed
     * delivery is included deliberately: it is finished from the RIDER's point of
     * view even though the clinic still has work to do on it.
     *
     * @return list<DeliveryStatus>
     */
    private function settledStatuses(): array
    {
        return [
            DeliveryStatus::Delivered,
            DeliveryStatus::Failed,
            DeliveryStatus::ReturnedToPharmacy,
        ];
    }

    /**
     * Refuse a settled delivery the rider is no longer entitled to read.
     *
     * `updated_at`, for the same reason the listing uses it: a failed delivery
     * and one returned to the pharmacy never set `delivered_at`, and every
     * transition calls save(), so for a settled row `updated_at` is the moment it
     * settled. See COMPLETED_WINDOW_HOURS for why there is a moment at all.
     */
    private function assertWithinDisclosureWindow(Delivery $delivery): void
    {
        if (! in_array($delivery->status, $this->settledStatuses(), true)) {
            return;
        }

        $settledAt = $delivery->getAttribute('updated_at');

        // A row with no timestamp cannot be aged out, and refusing one on that
        // basis would hide live work. Nothing writes a delivery without one.
        if (! $settledAt instanceof CarbonInterface) {
            return;
        }

        if ($settledAt->lt(Date::now()->subHours(self::COMPLETED_WINDOW_HOURS))) {
            throw new NotFoundHttpException;
        }
    }
}
