<?php

namespace App\Http\Resources\V1;

use App\Models\User;
use App\Support\PhoneNumber;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Carbon;

/**
 * A member of the clinic's staff, as its administrator sees them.
 *
 * Note what is absent. No password hash and no remember token, which the model
 * hides anyway; no clinical association of any kind. The staff list is an
 * administrative surface, and a person's clinical footprint is not part of
 * their staff record -- who consulted whom is in the audit trail, reachable
 * under its own authorisation.
 *
 * The phone appears in full rather than masked: this is the administrator of
 * the same clinic, who typed it in, and who needs it to ring a colleague whose
 * invitation did not arrive.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 *
 * @mixin User
 */
class StaffResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $phone = $this->phone;
        $phoneVerifiedAt = $this->phone_verified_at;

        return [
            'id' => $this->id,
            'name' => $this->name,
            'phone' => $phone instanceof PhoneNumber ? $phone->e164 : null,
            'email' => $this->email,

            // Roles, not permissions. The matrix is the contract, and a client
            // that reasons about individual permissions will drift from it.
            'roles' => $this->getRoleNames()->values()->all(),

            'is_active' => $this->is_active,

            // The signal an administrator actually needs while onboarding: an
            // invited colleague who never verified cannot sign in yet.
            'phone_verified_at' => $phoneVerifiedAt instanceof Carbon
                ? $phoneVerifiedAt->toIso8601String()
                : null,
        ];
    }
}
