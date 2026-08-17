<?php

namespace App\Http\Resources\V1;

use App\Models\Clinician;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A clinician, as a PATIENT choosing who to see sees them.
 *
 * Name, specialty, photo. That is the whole list, and the omissions are the
 * point.
 *
 * THE REGISTRATION NUMBER IS ABSENT AND MUST STAY ABSENT. A patient has no use
 * for it -- they are choosing a person, not auditing a register -- and
 * publishing it on an endpoint reachable by every patient of every clinic hands
 * anyone a harvestable list of practitioner credentials to impersonate. It is
 * exposed in exactly one place, snapshotted onto the prescription that
 * legally requires it.
 *
 * Nor is the practising licence expiry here, for a different reason: Carevelo
 * does not verify licences and has no access to the UMDPC, AHPC or Nurses &
 * Midwives registers. Showing our possibly-stale copy to a patient would read
 * as a verification we never performed.
 *
 * @see docs/40-api/endpoint-catalogue.md
 * @see docs/50-security-compliance/data-protection-dppa.md
 *
 * @mixin Clinician
 *
 * @property-read ?string $specialty
 * @property-read ?User $user
 */
class ClinicianResource extends JsonResource
{
    /**
     * @return array{id: string, name: string, specialty: ?string, photo_url: ?string}
     */
    public function toArray(Request $request): array
    {
        // Every field is deliberate. Adding one is a disclosure decision and
        // must be justified against the rule above.
        return [
            'id' => $this->id,
            'name' => $this->user->name ?? '',
            'specialty' => $this->specialty,
            // No column carries a clinician portrait yet. The key is published
            // anyway so the patient portal renders its placeholder from the
            // contract rather than from a missing-key check, and lands the real
            // image without a client change when the column arrives.
            'photo_url' => null,
        ];
    }
}
