<?php

namespace App\Http\Resources\V1;

use App\Models\Patient;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A patient, as clinic staff see them.
 *
 * No `tenant_id`: the caller is already inside exactly one tenant and cannot be
 * anywhere else. No clinical content either -- a Patient holds none, and the
 * pharmacist's and rider's narrower views are separate classes rather than this
 * one with fields hidden client-side.
 *
 * @mixin Patient
 */
class PatientResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'given_name' => $this->given_name,
            'family_name' => $this->family_name,
            'phone' => $this->phone,
            'email' => $this->email,
            'date_of_birth' => $this->date_of_birth?->toDateString(),
            'sex' => $this->sex,
            // Optional in perpetuity. A patient without one is a complete
            // record, not an incomplete one.
            'national_id_number' => $this->national_id_number,
            'address' => $this->address,
            'district' => $this->district,
            'guardian' => [
                'name' => $this->guardian_name,
                'phone' => $this->guardian_phone,
                'relationship' => $this->guardian_relationship,
            ],
            'status' => $this->status->value,
            'phone_verified' => $this->phone_verified_at !== null,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
