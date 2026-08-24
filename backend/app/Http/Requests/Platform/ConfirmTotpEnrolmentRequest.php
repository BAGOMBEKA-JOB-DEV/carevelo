<?php

namespace App\Http\Requests\Platform;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Support\Totp\Totp;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Proving that the authenticator the operator just set up actually works.
 *
 * ONE FIELD, AND NO RECOVERY CODE. Recovery codes do not exist yet at this point
 * in the flow -- they are minted by the confirmation this request drives -- and
 * an endpoint that accepted one here would be an endpoint that confirms an
 * enrolment using a credential issued against the PREVIOUS secret. That is
 * exactly the rotation an operator performs when they believe their old
 * authenticator is compromised, so honouring the old set to complete it would
 * let whoever holds a stolen sheet confirm a secret of their own choosing.
 *
 * @see docs/40-api/authentication-and-sessions.md § Second factor
 */
class ConfirmTotpEnrolmentRequest extends FormRequest
{
    use RejectsUnknownFields;

    /** The route is already behind auth:sanctum and RequireSecondFactor. */
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
            'code' => ['required', 'string', 'digits:'.Totp::DIGITS],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'code.required' => 'Enter the six-digit code your authenticator is showing.',
            'code.digits' => 'A code from your authenticator is six digits.',
        ];
    }

    public function code(): string
    {
        return trim((string) $this->validated('code'));
    }
}
