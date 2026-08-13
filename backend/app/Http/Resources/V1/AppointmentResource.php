<?php

namespace App\Http\Resources\V1;

use App\Models\Appointment;
use App\Models\ConsultationMode;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

/**
 * A booking, as clinic staff and the patient's own portal see it.
 *
 * An appointment holds no clinical content -- no reason for the visit, no
 * history, no note -- and this serialisation adds none. The service is exposed
 * as an identifier rather than a name because a service name ("Antenatal
 * Review") is itself health information about the person who booked it, and
 * the client already has the clinic's service list.
 *
 * tenant_id is absent by convention: the caller is already inside exactly one
 * tenant and cannot be anywhere else.
 *
 * @see docs/40-api/api-conventions.md
 *
 * @mixin Appointment
 *
 * @property-read Carbon $scheduled_start_at
 * @property-read Carbon $scheduled_end_at
 * @property-read Carbon $created_at
 * @property-read string $patient_id
 * @property-read string $clinician_id
 * @property-read string $service_id
 * @property-read ConsultationMode $mode_booked
 * @property-read string $payment_expectation
 * @property-read ?string $cancellation_reason
 */
class AppointmentResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            // What the clinic and the patient actually say aloud on the phone,
            // which is how most support in this market happens.
            'reference' => $this->reference,
            'status' => $this->status->value,
            'patient_id' => $this->patient_id,
            'clinician_id' => $this->clinician_id,
            'service_id' => $this->service_id,
            'scheduled_start_at' => $this->scheduled_start_at->toIso8601String(),
            'scheduled_end_at' => $this->scheduled_end_at->toIso8601String(),
            'mode_booked' => $this->mode_booked->value,
            'payment_expectation' => $this->payment_expectation,
            'cancellation_reason' => $this->cancellation_reason,
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
