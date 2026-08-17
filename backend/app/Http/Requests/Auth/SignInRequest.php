<?php

namespace App\Http\Requests\Auth;

use App\Http\Requests\Auth\Concerns\ResolvesPhoneNumber;
use App\Support\PhoneNumber;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Password sign-in, by email address or by phone number.
 *
 * BOTH, because the two audiences are genuinely different. A clinic administrator sits at
 * a desk with an email address and expects to type it; a clinician between rooms has their
 * phone in their hand and their number is the identifier the clinic already holds. The
 * business plan is blunt about the second case: most Ugandan clinic staff have a working
 * phone and no reliably checked email address, so neither identifier can be the only way in.
 *
 * Exactly one is required. Sending both is a confused client rather than a convenience,
 * and picking one silently would mean two requests that look identical signing in as
 * different people.
 *
 * Patients may also use a code with no password at all, which is a different endpoint.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
class SignInRequest extends FormRequest
{
    use ResolvesPhoneNumber;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // required_without rather than required: either identifies the account, and
            // the pair is mutually exclusive below.
            'email' => ['required_without:phone', 'prohibits:phone', 'nullable', 'string', 'email', 'max:255'],
            'phone' => ['required_without:email', 'nullable', 'string', $this->phoneRule()],

            // No length or composition rule on the way IN. A minimum here tells an
            // attacker the shape of what to guess, and rejects a correct password set
            // before the rule existed.
            'password' => ['required', 'string'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'email.required_without' => 'Enter your email address or your phone number.',
            'phone.required_without' => 'Enter your email address or your phone number.',
            'email.prohibits' => 'Sign in with either an email address or a phone number, not both.',
        ];
    }

    /** Which field identifies the account: 'email' or 'phone'. */
    public function identifierField(): string
    {
        return $this->filled('email') ? 'email' : 'phone';
    }

    /**
     * The account key.
     *
     * A normalised E.164 number, or a lowercased email. Lowercased because addresses are
     * not case-sensitive in practice and "Sarah@" failing where "sarah@" works is a
     * support call, not a security control.
     */
    public function identifier(): string
    {
        if ($this->identifierField() === 'email') {
            return mb_strtolower(trim((string) $this->validated('email')));
        }

        return PhoneNumber::parse((string) $this->validated('phone'))->e164;
    }

    public function password(): string
    {
        return (string) $this->validated('password');
    }
}
