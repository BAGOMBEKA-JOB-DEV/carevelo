<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

/**
 * What an invitee may choose about their own account.
 *
 * A password, and an email address if they have one. NOT a role, NOT a phone
 * number and NOT a clinic: those three are fixed by the invitation, and the
 * controller reads them off the invitation row rather than from here.
 *
 * `role` is absent from the rules on purpose, so a body carrying one is
 * discarded before the controller ever sees it. There is no code path from this
 * request to a role assignment.
 */
class AcceptInvitationRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'password' => ['required', 'string', 'confirmed', Password::defaults()],

            // Optional everywhere in this product. Most Ugandan clinic staff
            // have a working phone and no reliably checked email address, and
            // requiring one here would stop them joining.
            'email' => ['nullable', 'email', 'max:255', 'unique:users,email'],
        ];
    }

    public function password(): string
    {
        return (string) $this->validated('password');
    }

    public function email(): ?string
    {
        $email = $this->validated('email');

        return is_string($email) && $email !== '' ? $email : null;
    }
}
