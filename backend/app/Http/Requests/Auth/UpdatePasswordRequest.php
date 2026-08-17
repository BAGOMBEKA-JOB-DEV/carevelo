<?php

namespace App\Http\Requests\Auth;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rules\Password;

class UpdatePasswordRequest extends FormRequest
{
    /**
     * The current password is required, not optional.
     *
     * It is the one thing a hijacked session does not carry. Without it, an
     * attacker holding a session cookie from a shared clinic terminal could
     * change the password and lock the owner out of their own account -- and,
     * because a password change revokes every other session, out of the very
     * session they would use to notice.
     *
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'current_password' => ['required', 'string'],
            'password' => ['required', 'string', 'confirmed', Password::defaults()],
        ];
    }

    public function currentPassword(): string
    {
        return (string) $this->validated('current_password');
    }

    public function newPassword(): string
    {
        return (string) $this->validated('password');
    }
}
