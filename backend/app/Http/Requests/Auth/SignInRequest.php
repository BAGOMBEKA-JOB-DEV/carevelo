<?php

namespace App\Http\Requests\Auth;

use App\Http\Requests\Auth\Concerns\ResolvesPhoneNumber;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Phone plus password, for staff.
 *
 * Patients do not come through here: they sign in with a code alone. Requiring
 * a password from someone who consults twice a year produces forgotten
 * passwords, and a forgotten password in this product means abandoned care.
 */
class SignInRequest extends FormRequest
{
    use ResolvesPhoneNumber;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return $this->phoneRules() + [
            // No length or composition rule on the way IN. A minimum here tells
            // an attacker the shape of what to guess, and rejects a correct
            // password set before the rule existed.
            'password' => ['required', 'string'],
        ];
    }

    public function password(): string
    {
        return (string) $this->validated('password');
    }
}
