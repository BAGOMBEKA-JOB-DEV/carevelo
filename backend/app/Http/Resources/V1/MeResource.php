<?php

namespace App\Http\Resources\V1;

use App\Models\User;
use App\Support\PhoneNumber;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * The signed-in account, as it sees itself.
 *
 * `GET /v1/me` returned the raw Eloquent model until this existed, which made it
 * the one endpoint in the API with no schema: the published contract could not
 * describe it, so the frontend carried a hand-written type instead, and the
 * shape of the response was whatever the users table happened to contain that
 * week. It shipped `tenant_id`, both timestamps and `is_active` to the browser
 * as a side effect of nobody choosing.
 *
 * `tenant_id` is absent for the reason it is absent from every other resource:
 * the caller is already inside exactly one tenant and cannot be anywhere else,
 * so the identifier answers no question a client may ask.
 *
 * `password_change_required` is a BOOLEAN, not the timestamp behind it. The
 * client needs to know whether to show the password form; when the clinic issued
 * the credential is the clinic's business, and it is on the staff surface.
 *
 * Roles rather than permissions. The RBAC matrix is the contract, and a client
 * that reasons about individual permissions will drift from it.
 *
 * @see docs/40-api/authentication-and-sessions.md
 *
 * @mixin User
 */
class MeResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $phone = $this->phone;

        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'phone' => $phone instanceof PhoneNumber ? $phone->e164 : null,

            // Non-null means every endpoint but this one, the password change and
            // sign-out is refused with `password_change_required`. Sending it
            // here is what lets a client explain that rather than discovering it
            // one 403 at a time.
            'password_change_required' => $this->mustChangePassword(),

            'roles' => $this->getRoleNames()->values()->all(),
        ];
    }
}
