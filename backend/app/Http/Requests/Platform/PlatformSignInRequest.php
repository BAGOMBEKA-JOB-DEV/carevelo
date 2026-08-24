<?php

namespace App\Http\Requests\Platform;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The password half of a platform operator's sign-in.
 *
 * ============================================================
 * AN EMAIL ADDRESS. THERE IS NO PHONE FIELD AND THERE MUST NOT BE ONE.
 * ============================================================
 *
 * SignInRequest -- the tenant one -- takes an email address OR a phone number,
 * because a clinician between rooms has their number in hand and most Ugandan
 * clinic staff have no reliably-checked email address. None of that applies
 * here. A platform operator is a Carevelo employee at a desk, and the account
 * they hold has `tenant_id = null` and is found by address alone
 * (App\Support\Auth\PlatformAccounts). Adding a phone field would introduce an
 * identifier this surface has no lookup for and no reason to want, on the one
 * account in the product whose second factor must never touch a mobile network
 * -- see App\Support\Totp\Totp::uri() for why at length.
 *
 * ============================================================
 * THE PASSWORD ALONE GETS NOBODY IN
 * ============================================================
 *
 * A successful request here does not return a session. It returns "now show me a
 * code", and PlatformAuthController opens no session until one verifies. The
 * split into two requests is not decoration either: a single form taking a
 * password and a code together has to say which half was wrong, and "the
 * password is right, the code is not" is a sentence worth a great deal to
 * somebody working through a credential-stuffing list.
 *
 * @see docs/40-api/authentication-and-sessions.md § Second factor
 */
class PlatformSignInRequest extends FormRequest
{
    use RejectsUnknownFields;

    /** Public by necessity: nobody is authenticated at this point. */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'email' => ['required', 'string', 'email', 'max:255'],

            // No length or composition rule on the way IN, exactly as the tenant
            // sign-in has none. A minimum here tells an attacker the shape of
            // what to guess, and would refuse a correct password that was set
            // before the rule existed.
            'password' => ['required', 'string'],
        ];
    }

    /**
     * The account key.
     *
     * Lowercased, because addresses are not case-sensitive in practice and
     * "Sarah@" failing where "sarah@" works is a support call rather than a
     * security control. PlatformAccounts compares `lower(email)` to match.
     */
    public function email(): string
    {
        return mb_strtolower(trim((string) $this->validated('email')));
    }

    public function password(): string
    {
        return (string) $this->validated('password');
    }
}
