<?php

namespace App\Http\Requests\Platform;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Support\Totp\Totp;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The code half of a platform operator's sign-in.
 *
 * ============================================================
 * ONE OF TWO CREDENTIALS, NEVER BOTH
 * ============================================================
 *
 * `code` is six digits from the authenticator app. `recovery_code` is one of the
 * ten strings issued at enrolment, for the operator whose authenticator is in a
 * drawer at home. Exactly one is required, and sending both is a confused client
 * rather than a convenience: a request carrying both would have to be resolved
 * by a precedence rule, and a precedence rule on a credential check is a way of
 * choosing which of two comparisons an attacker gets to skip.
 *
 * ============================================================
 * WHY THE VALIDATION HERE IS SO THIN
 * ============================================================
 *
 * `code` is `digits:6` and nothing else -- no "must be numeric and current", no
 * check against the window, no hint about whether the account is even enrolled.
 * Every one of those decisions belongs to TotpAuthenticator, which answers them
 * in constant time and returns one sentence for all of the failures. A rule here
 * that refused a well-formed-but-wrong code with a DIFFERENT message from a
 * malformed one would hand a caller a free oracle, one 422 at a time, and it
 * would do it before the rate limiter had counted the attempt.
 *
 * The six-digit length is safe to state because it is a fact about the format
 * that every authenticator app in the world already publishes, and refusing a
 * five-character string saves a database read.
 *
 * `recovery_code` is deliberately loose: the codes are shown grouped in fours
 * and get read down a telephone, so hyphens, spaces and lower case all arrive in
 * practice. RecoveryCodes::spend() normalises before it digests; a strict
 * pattern here would refuse a correct credential over its punctuation.
 *
 * @see docs/40-api/authentication-and-sessions.md § Second factor
 */
class SecondFactorChallengeRequest extends FormRequest
{
    use RejectsUnknownFields;

    /** Public by necessity: there is no session yet, which is the whole point. */
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
            'code' => [
                'required_without:recovery_code',
                'prohibits:recovery_code',
                'nullable',
                'string',
                'digits:'.Totp::DIGITS,
            ],
            'recovery_code' => [
                'required_without:code',
                'nullable',
                'string',
                'max:64',
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'code.required_without' => 'Enter the code from your authenticator, or one of your recovery codes.',
            'recovery_code.required_without' => 'Enter the code from your authenticator, or one of your recovery codes.',
            'code.prohibits' => 'Send either a code from your authenticator or a recovery code, not both.',
            'code.digits' => 'A code from your authenticator is six digits.',
        ];
    }

    /** Whether this request is spending a recovery code rather than a live one. */
    public function isRecovery(): bool
    {
        return $this->filled('recovery_code');
    }

    /**
     * The credential presented, whichever kind it is.
     *
     * Untrimmed of anything but surrounding whitespace. What counts as
     * incidental punctuation inside a recovery code is RecoveryCodes'
     * to decide -- it normalises before digesting, and a second normalisation
     * here would be a second definition of what a code IS, free to disagree.
     */
    public function credential(): string
    {
        return trim((string) $this->validated($this->isRecovery() ? 'recovery_code' : 'code'));
    }
}
