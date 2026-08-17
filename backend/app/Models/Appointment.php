<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use App\Models\Concerns\ScopedToPatientOwner;
use App\Models\Contracts\RestrictableToPatient;
use Database\Factories\AppointmentFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;

/**
 * A booking: patient, service, clinician, slot, mode, payment expectation.
 *
 * Distinct from Consultation. An appointment may be cancelled or no-showed and
 * never become one -- conflating them loses the ability to measure no-shows,
 * which is a number the clinic owner cares about.
 *
 * @property string $id
 * @property string $reference
 * @property AppointmentStatus $status
 * @property ?string $patient_id
 * @property ?string $clinician_id
 * @property ?Carbon $scheduled_start_at
 * @property ?Carbon $scheduled_end_at
 */
class Appointment extends Model implements RestrictableToPatient
{
    use BelongsToTenant;

    /** @use HasFactory<AppointmentFactory> */
    use HasFactory;

    use HasUlids;
    use ScopedToPatientOwner;

    protected $fillable = [
        'reference', 'patient_id', 'clinician_id', 'service_id',
        'scheduled_start_at', 'scheduled_end_at', 'mode_booked',
        'payment_expectation', 'status', 'cancellation_reason',
    ];

    /**
     * How long an unpaid booking holds its slot before the system releases it.
     *
     * Chosen to match the aggressive phase of PaymentIntent::POLL_SCHEDULE, which
     * polls every minute for the first fifteen. The slot is therefore released at
     * the moment the system stops expecting an imminent mobile-money confirmation
     * — generous for a patient on a slow USSD prompt, without leaving a slot dead
     * for half an hour.
     *
     * It matters because availability deliberately excludes `awaiting_payment`
     * bookings: the slot is genuinely held while the prompt is on the handset. So
     * an abandoned prompt with nothing to release it removes a slot from the
     * clinic's calendar permanently, which is what it did until this existed.
     *
     * @see docs/10-product/prd-h3-teleconsultation.md
     * @see app/Console/Commands/ReleaseUnpaidAppointmentsCommand.php
     */
    public const UNPAID_HOLD_MINUTES = 15;

    /**
     * How long past its scheduled end an in-progress appointment may sit before
     * it is treated as abandoned.
     *
     * The patient gets a resume link first; only once this window closes is the
     * call taken to have dropped for good. Long enough that a clinician
     * reconnecting after a power cut resumes the same consultation rather than
     * finding it closed.
     *
     * @see docs/20-domain/state-machines.md
     */
    public const RESUME_WINDOW_MINUTES = 60;

    /**
     * scheduled_start_at, scheduled_end_at are timestamptz.
     *
     * Laravel's default format is naive ('Y-m-d H:i:s'), so PostgreSQL resolves
     * the missing offset in the SESSION's timezone rather than the application's.
     * The instant stored then depends on how the database server happens to be
     * configured. What shifts here is the appointment a patient believes they booked. A shift offers the same slot twice, or sends a patient to a call hours from the one they paid for.
     *
     * Columns declared without a timezone ignore the offset, so created_at and
     * updated_at are unaffected.
     *
     * @var string
     */
    protected $dateFormat = 'Y-m-d H:i:sP';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => AppointmentStatus::class,
            'mode_booked' => ConsultationMode::class,
            'scheduled_start_at' => 'datetime',
            'scheduled_end_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<Patient, $this> */
    public function patient(): BelongsTo
    {
        return $this->belongsTo(Patient::class);
    }

    public function confirm(): void
    {
        $this->transitionTo(AppointmentStatus::Confirmed);
    }

    public function cancel(string $reason): void
    {
        $this->cancellation_reason = $reason;
        $this->transitionTo(AppointmentStatus::Cancelled);
    }

    public function markNoShow(): void
    {
        $this->transitionTo(AppointmentStatus::NoShow);
    }

    public function transitionTo(AppointmentStatus $status): void
    {
        $this->status->assertCanTransitionTo($status);

        $this->status = $status;
        $this->save();
    }
}
