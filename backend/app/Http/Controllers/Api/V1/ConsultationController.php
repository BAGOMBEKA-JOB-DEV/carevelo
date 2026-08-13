<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Exceptions\StateMachine\IllegalTransition;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Consultations\EndConsultationRequest;
use App\Http\Requests\V1\Consultations\RecordModeRequest;
use App\Http\Requests\V1\Consultations\StartConsultationRequest;
use App\Http\Resources\V1\ConsultationResource;
use App\Models\Appointment;
use App\Models\AppointmentStatus;
use App\Models\Clinician;
use App\Models\Consultation;
use App\Models\ConsultationMode;
use App\Models\ConsultationOutcome;
use App\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;

/**
 * The consultation encounter.
 *
 * Every method here records a fact rather than deciding one. Carevelo does not
 * conduct consultations, judge outcomes or choose a mode -- the clinician of the
 * clinic does, and this controller writes down what they did.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md sections 4-7
 */
class ConsultationController extends Controller
{
    public function __construct(private readonly AuditLog $audit) {}

    /**
     * Start a consultation: the clinician has joined.
     */
    public function store(StartConsultationRequest $request): JsonResponse
    {
        // Only a clinician conducts a consultation. Front desk books it,
        // administrators can read it, neither may hold it.
        $this->authorize('create', Consultation::class);

        /** @var User $user */
        $user = $request->user();

        $appointment = Appointment::query()->findOrFail($request->string('appointment_id')->toString());

        $clinician = Clinician::query()->where('user_id', $user->id)->first();

        if ($clinician === null) {
            // The clinician role alone is not enough. A clinical encounter is
            // held by a practitioner registered with the UMDPC, AHPC or the
            // Nurses & Midwives Council and engaged by THIS clinic, and that is
            // the Clinician record, not the role.
            throw new IllegalTransition(
                'A consultation is conducted by a registered clinician of this clinic. '
                .'This account is not linked to a clinician record.'
            );
        }

        if (Consultation::query()->where('appointment_id', $appointment->id)->exists()) {
            throw new IllegalTransition('This appointment already has a consultation.');
        }

        $mode = $request->has('mode_used')
            ? ConsultationMode::from($request->string('mode_used')->toString())
            : $this->bookedMode($appointment);

        $consultation = DB::transaction(function () use ($appointment, $clinician, $mode) {
            // Ordered before the insert: a cancelled, expired or already
            // consulted appointment must fail here rather than leave a
            // consultation attached to a slot nobody attended.
            $appointment->transitionTo(AppointmentStatus::InProgress);

            $consultation = Consultation::create([
                'appointment_id' => $appointment->id,
                'patient_id' => $appointment->patient_id,
                'clinician_id' => $clinician->id,
                'started_at' => Date::now(),
                'mode_used' => $mode,
            ]);

            $this->audit->record('consultation.started', 'consultation', $consultation->id, [
                'appointment_id' => $appointment->id,
                'clinician_id' => $clinician->id,
                'mode_used' => $mode->value,
            ]);

            return $consultation;
        });

        return ConsultationResource::make($consultation)->response()->setStatusCode(201);
    }

    public function show(Consultation $consultation): ConsultationResource
    {
        $this->authorize('view', $consultation);

        // Audited on every read, not only on administrator reads. Who looked at
        // an encounter is the question a subject access request or a breach
        // investigation actually asks.
        $this->audit->record('consultation.viewed', 'consultation', $consultation->id);

        return ConsultationResource::make($consultation);
    }

    /**
     * Record the mode the consultation is actually being held in.
     *
     * The step-down is recorded TRUTHFULLY. A consultation booked as video and
     * conducted over voice is stored as voice, and the booked mode on the
     * appointment is left alone as the record of what was agreed. Reporting the
     * booked mode would misstate the encounter clinically and would flatter us
     * commercially, which is the reason the temptation exists.
     */
    public function recordMode(RecordModeRequest $request, Consultation $consultation): ConsultationResource
    {
        $this->authorize('conduct', $consultation);

        $this->assertInProgress($consultation);

        $from = $consultation->mode_used;
        $to = ConsultationMode::from($request->string('mode')->toString());

        DB::transaction(function () use ($consultation, $from, $to) {
            $consultation->degradeTo($to);

            $this->audit->record('consultation.mode_recorded', 'consultation', $consultation->id, [
                'from' => $from->value,
                'to' => $to->value,
            ]);
        });

        return ConsultationResource::make($consultation);
    }

    /**
     * End the consultation. An outcome is required.
     */
    public function end(EndConsultationRequest $request, Consultation $consultation): ConsultationResource
    {
        $this->authorize('conduct', $consultation);

        $this->assertInProgress($consultation);

        $outcome = ConsultationOutcome::from($request->string('outcome')->toString());

        DB::transaction(function () use ($consultation, $outcome) {
            $consultation->end($outcome);

            $this->closeAppointment($consultation, $outcome);

            $this->audit->record('consultation.ended', 'consultation', $consultation->id, [
                'outcome' => $outcome->value,
            ]);
        });

        return ConsultationResource::make($consultation);
    }

    /**
     * The mode the appointment was booked in.
     *
     * Only the starting assumption. What is booked is what the patient chose;
     * what is stored on the consultation from here on is what actually
     * happened.
     */
    private function bookedMode(Appointment $appointment): ConsultationMode
    {
        /** @var mixed $booked */
        $booked = $appointment->getAttribute('mode_booked');

        return $booked instanceof ConsultationMode ? $booked : ConsultationMode::Video;
    }

    private function assertInProgress(Consultation $consultation): void
    {
        if ($consultation->ended_at !== null) {
            throw new IllegalTransition(
                'This consultation has already ended. Its record is closed; a '
                .'correction is made by addendum to its notes.'
            );
        }
    }

    /**
     * Close the appointment the consultation was held under.
     *
     * The appointment state machine offers exactly two terminal states from
     * in_progress, and `abandoned` is documented as the dropped call that could
     * not be resumed -- so it maps to technical_failure and to nothing else. An
     * encounter the clinician ended deliberately took place and consumed the
     * slot, including one converted to in-person care.
     *
     * Guarded rather than assumed: another actor may already have closed the
     * appointment, and a consultation ending must not fail because of it.
     *
     * @see docs/20-domain/state-machines.md
     */
    private function closeAppointment(Consultation $consultation, ConsultationOutcome $outcome): void
    {
        $appointment = Appointment::query()->find($consultation->appointment_id);

        if ($appointment === null || $appointment->status !== AppointmentStatus::InProgress) {
            return;
        }

        $appointment->transitionTo(
            $outcome === ConsultationOutcome::TechnicalFailure
                ? AppointmentStatus::Abandoned
                : AppointmentStatus::Completed
        );
    }
}
