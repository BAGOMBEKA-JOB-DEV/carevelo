<?php

namespace App\Http\Resources\V1;

use App\Models\Clinician;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A clinician, as the ADMINISTRATOR who recorded them sees them.
 *
 * A second class rather than fields switched on inside ClinicianResource, and
 * the split is the point. ClinicianResource is reachable by every patient of
 * the clinic, so the registration number is absent from it and must stay
 * absent: a credential list published to anyone who can book an appointment is
 * a credential list published to anyone who can open an account. The house rule
 * is that a narrower audience gets its own resource class, never the same class
 * with fields hidden in the UI.
 *
 * Here the audience is the clinic administrator who TYPED these details in, on
 * a Carevelo-branded console behind an administrator-only route, and who has to
 * be able to read back what they entered in order to correct a typo. The RBAC
 * matrix puts staff administration in that one column, and this is staff
 * administration.
 *
 * `may_prescribe` is derived rather than stored, and is the field a console
 * should actually render. `can_prescribe` alone is a half-truth: the flag can be
 * on while the registration number is blank, in which case the clinician cannot
 * prescribe and the screen must not suggest otherwise.
 *
 * `has_expired_licence` WARNS. It does not block, and no client should treat it
 * as blocking: licence currency is the clinic's regulatory responsibility, and
 * refusing care on the strength of our possibly-stale copy would be the worse
 * error.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 * @see docs/40-api/api-conventions.md
 *
 * @mixin Clinician
 *
 * @property-read ?User $user
 */
class ClinicianProfileResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'user_id' => $this->user_id,
            'name' => $this->user->name ?? '',

            // Recorded, never verified. A client rendering this must say so:
            // Carevelo has no access to the UMDPC, AHPC or Nurses & Midwives
            // registers, and showing an attestation as though it were a check
            // would be false and, if relied upon, harmful.
            'registration_body' => $this->registration_body,
            'registration_number' => $this->registration_number,

            'specialty' => $this->specialty,
            'practising_licence_expires_at' => $this->practising_licence_expires_at?->toDateString(),

            'can_prescribe' => $this->can_prescribe,
            'may_prescribe' => $this->mayPrescribe(),
            'has_expired_licence' => $this->hasExpiredLicence(),
        ];
    }
}
