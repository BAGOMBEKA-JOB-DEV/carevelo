<?php

namespace App\Models;

use App\Models\Concerns\BelongsToTenant;
use Database\Factories\AppointmentFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

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
 */
class Appointment extends Model
{
    use BelongsToTenant;

    /** @use HasFactory<AppointmentFactory> */
    use HasFactory;

    use HasUlids;

    protected $fillable = [
        'reference', 'patient_id', 'clinician_id', 'service_id',
        'scheduled_start_at', 'scheduled_end_at', 'mode_booked',
        'payment_expectation', 'status', 'cancellation_reason',
    ];

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
