<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Http\Controllers\Api\V1\Concerns\AuthorisesPatientReads;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Appointments\CancelAppointmentRequest;
use App\Http\Requests\V1\Appointments\IndexAppointmentRequest;
use App\Http\Requests\V1\Appointments\StoreAppointmentRequest;
use App\Http\Resources\V1\AppointmentResource;
use App\Models\Appointment;
use App\Models\AppointmentStatus;
use App\Models\Service;
use App\Support\ReferenceGenerator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Booking: the front half of H3.
 *
 * Two rules shape everything here.
 *
 * A clinician cannot hold two overlapping appointments. That is a domain
 * invariant, not a nicety -- a double-booked clinician means one of two
 * patients waits alone on a video call they paid for.
 *
 * A prepaid booking is NOT confirmed by us deciding it is. It reaches
 * `confirmed` on a succeeded PaymentIntent, or by an explicit, audited staff
 * deferral. Carevelo holds no funds and takes no view on whether a patient has
 * paid; it records what the clinic and its aggregator report.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md
 * @see docs/20-domain/state-machines.md
 */
class AppointmentController extends Controller
{
    use AuthorisesPatientReads;

    /**
     * The statuses that occupy a clinician's slot.
     *
     * `awaiting_payment` is included because a prepaid booking holds the slot
     * while the patient pays (§H3.2). Releasing it the moment payment is
     * pending would let a second patient book over someone mid-transaction --
     * and they would then have paid for a slot that is gone. A hold that
     * outlives its window is released by expiry, which moves the appointment
     * out of this list.
     *
     * @var list<AppointmentStatus>
     */
    private const SLOT_HOLDING = [
        AppointmentStatus::AwaitingPayment,
        AppointmentStatus::Confirmed,
        AppointmentStatus::InProgress,
    ];

    public function __construct(
        protected AuditLog $audit,
        protected ReferenceGenerator $references,
    ) {}

    /**
     * The clinic's schedule, filtered.
     */
    public function index(IndexAppointmentRequest $request): AnonymousResourceCollection
    {
        // Authorises AND narrows. A patient reaches their own appointments here;
        // staff reach the clinic's. See AuthorisesPatientReads for why the two are
        // one call rather than two lines that must both be remembered.
        $query = $this->authoriseListing(Appointment::query(), $request->user(), Appointment::class);

        if (($status = $request->status()) !== null) {
            $query->where('status', $status->value);
        }

        if (($clinicianId = $request->clinicianId()) !== null) {
            $query->where('clinician_id', $clinicianId);
        }

        if (($from = $request->from()) !== null) {
            $query->where('scheduled_start_at', '>=', $from);
        }

        if (($to = $request->to()) !== null) {
            $query->where('scheduled_start_at', '<=', $to);
        }

        // The id tiebreaker is not decoration: a cursor over a non-unique sort
        // column skips and repeats rows, and a skipped row here is a missed
        // appointment.
        $query->orderBy('scheduled_start_at', $request->sortsDescending() ? 'desc' : 'asc')
            ->orderBy('id');

        return AppointmentResource::collection($query->cursorPaginate($request->perPage()));
    }

    /**
     * Book a slot.
     *
     * Prepaid opens in `awaiting_payment`; pay-at-clinic goes straight to
     * `confirmed`. Both are legitimate first states -- a clinic whose
     * aggregator is not configured still books patients, because payment is a
     * feature and care is not blocked on it (§H1.6).
     */
    public function store(StoreAppointmentRequest $request): JsonResponse
    {
        $this->authorize('create', Appointment::class);

        $service = Service::query()->findOrFail($request->string('service_id')->toString());

        $start = $request->startsAt();
        $end = $request->endsAt($service);

        $appointment = DB::transaction(function () use ($request, $start, $end): Appointment {
            $clinicianId = $request->string('clinician_id')->toString();

            if ($this->slotIsTaken($clinicianId, $start, $end)) {
                // A validation error rather than a transition failure: nothing
                // has been attempted yet, and the client's remedy is to pick a
                // different time.
                throw ValidationException::withMessages([
                    'scheduled_start_at' => 'This slot is no longer available.',
                ]);
            }

            $appointment = Appointment::create([
                'reference' => $this->references->next('APT'),
                'patient_id' => $request->string('patient_id')->toString(),
                'clinician_id' => $clinicianId,
                'service_id' => $request->string('service_id')->toString(),
                'scheduled_start_at' => $start,
                'scheduled_end_at' => $end,
                'mode_booked' => $request->string('mode_booked')->toString(),
                'payment_expectation' => $request->string('payment_expectation')->toString(),
                'status' => $request->isPrepaid()
                    ? AppointmentStatus::AwaitingPayment
                    : AppointmentStatus::Confirmed,
            ]);

            // Identifiers and outcomes only. Which service was booked stays out
            // of the audit trail: a service name is health information about
            // the person who booked it, and an audit event records THAT
            // something happened to WHICH record, never what the record said.
            $this->audit->record(
                'appointment.booked',
                subjectType: 'Appointment',
                subjectId: $appointment->id,
                metadata: [
                    'reference' => $appointment->reference,
                    'status' => $appointment->status->value,
                    'payment_expectation' => $request->string('payment_expectation')->toString(),
                    'mode_booked' => $request->string('mode_booked')->toString(),
                    'clinician_id' => $clinicianId,
                    'patient_id' => $request->string('patient_id')->toString(),
                ],
            );

            return $appointment;
        });

        return (new AppointmentResource($appointment))->response()->setStatusCode(201);
    }

    public function show(Appointment $appointment): AppointmentResource
    {
        $this->authorize('view', $appointment);

        return new AppointmentResource($appointment);
    }

    /**
     * Cancel, releasing the slot immediately.
     *
     * The state machine decides whether this is legal; a completed or already
     * cancelled appointment throws rather than quietly accepting a second
     * cancellation.
     */
    public function cancel(CancelAppointmentRequest $request, Appointment $appointment): AppointmentResource
    {
        $this->authorize('cancel', $appointment);

        $previous = $appointment->status;

        DB::transaction(function () use ($appointment, $request, $previous): void {
            $appointment->cancel($request->reason());

            // The reason itself is stored on the appointment but NEVER copied
            // into the audit event. It is free text typed by a receptionist or
            // a patient and routinely names a condition -- "her malaria
            // cleared up" is a diagnosis, and the audit log takes none.
            $this->audit->record(
                'appointment.cancelled',
                subjectType: 'Appointment',
                subjectId: $appointment->id,
                metadata: [
                    'reference' => $appointment->reference,
                    'previous_status' => $previous->value,
                ],
            );
        });

        return new AppointmentResource($appointment);
    }

    /**
     * Confirm an unpaid appointment on a staff member's authority (§H3.3).
     *
     * The administrator is vouching for a patient who will settle at the desk,
     * or whose mobile-money transfer the clinic has seen and we have not. It is
     * a deliberate override of the normal precondition, so it is restricted to
     * the administrator by policy and always audited -- an unaudited way to
     * mark something paid is an invitation.
     */
    public function confirmDeferred(Appointment $appointment): AppointmentResource
    {
        $this->authorize('confirmDeferred', $appointment);

        $previous = $appointment->status;

        DB::transaction(function () use ($appointment, $previous): void {
            // Re-checked here, not only at booking: the slot may have been
            // taken by a confirmed appointment while this one sat unpaid, and
            // confirming into it would double-book the clinician.
            $taken = $this->slotIsTaken(
                (string) $appointment->clinician_id,
                Date::parse($appointment->scheduled_start_at),
                Date::parse($appointment->scheduled_end_at),
                $appointment->id,
            );

            if ($taken) {
                throw new IllegalTransition(
                    'Another appointment now holds this clinician\'s slot. '
                    .'Rebook the patient before confirming.'
                );
            }

            $appointment->confirm();

            $this->audit->record(
                'appointment.confirmed_deferred',
                subjectType: 'Appointment',
                subjectId: $appointment->id,
                metadata: [
                    'reference' => $appointment->reference,
                    'previous_status' => $previous->value,
                ],
            );
        });

        return new AppointmentResource($appointment);
    }

    /**
     * Whether the clinician already holds an overlapping slot.
     *
     * Half-open comparison: an appointment ending at 09:30 does not collide
     * with one starting at 09:30, which is how a back-to-back clinic list is
     * meant to read.
     *
     * The definitive guard would be a PostgreSQL exclusion constraint over the
     * time range, which no read can race. Until that migration exists this
     * check runs inside the booking transaction, which narrows the window
     * without closing it.
     */
    private function slotIsTaken(
        string $clinicianId,
        Carbon $start,
        Carbon $end,
        ?string $ignoreAppointmentId = null,
    ): bool {
        $query = Appointment::query()
            ->where('clinician_id', $clinicianId)
            ->whereIn('status', array_map(
                fn (AppointmentStatus $status): string => $status->value,
                self::SLOT_HOLDING,
            ))
            ->where('scheduled_start_at', '<', $end)
            ->where('scheduled_end_at', '>', $start);

        if ($ignoreAppointmentId !== null) {
            $query->whereKeyNot($ignoreAppointmentId);
        }

        return $query->exists();
    }
}
