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
            // Non-null means this registration was a duplicate and its history
            // now lives on the record named here. Staff who reach it by an old
            // link need somewhere to go, so the pointer is part of the record.
            'merged_into_patient_id' => $this->merged_into_patient_id,
            'phone_verified' => $this->phone_verified_at !== null,

            // Whether an account can already reach this record as its own.
            // Derived, and never the account's identifier or address: front desk
            // needs to know whether to offer to create one, and nothing more.
            //
            // It is here rather than on an endpoint of its own because "does this
            // person have an account here" is a question worth not being able to
            // ask directly. Reading it as part of a record you are already
            // authorised to read asks nothing new.
            'has_account' => $this->isClaimed(),

            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
