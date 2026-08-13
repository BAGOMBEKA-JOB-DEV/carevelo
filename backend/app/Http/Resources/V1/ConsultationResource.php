<?php

namespace App\Http\Resources\V1;

use App\Models\Consultation;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

/**
 * A consultation encounter.
 *
 * `mode_used` is what ACTUALLY happened, which may differ from the mode booked.
 * A call that fell back to voice is reported as voice: the clinic is owed an
 * honest picture of what its patients on Ugandan mobile data experience, and a
 * consultation conducted by text is a different encounter from one conducted by
 * video.
 *
 * Carries no clinical content. Notes appear only when explicitly loaded, and
 * their own endpoint is the audited path to them.
 *
 * @mixin Consultation
 *
 * The two timestamps are declared here because the model does not annotate
 * them, and level 8 reads an unannotated `datetime` cast as the raw column
 * string. Documenting the real type is preferable to casting around it.
 *
 * @property ?Carbon $started_at
 * @property ?Carbon $ended_at
 */
class ConsultationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'appointment_id' => $this->appointment_id,
            'patient_id' => $this->patient_id,
            'clinician_id' => $this->clinician_id,
            'mode_used' => $this->mode_used->value,
            'outcome' => $this->outcome?->value,
            'started_at' => $this->started_at?->toIso8601String(),
            'ended_at' => $this->ended_at?->toIso8601String(),
            'notes' => ClinicalNoteResource::collection($this->whenLoaded('notes')),
        ];
    }
}
