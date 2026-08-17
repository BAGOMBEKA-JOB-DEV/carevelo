<?php

namespace App\Http\Requests\Platform;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Models\BreakGlassGrant;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;
use Illuminate\Validation\Rule;

/**
 * Requesting clinical access to a clinic's records.
 *
 * Four fields, and none of them is optional in substance:
 *
 *   tenant_id  — whose records
 *   reason     — why, in enough words to be reviewable
 *   scope      — which records, from a closed list
 *   expires_at — until when, and no longer than a day
 *
 * A minimum length on the reason is a blunt instrument and is here on purpose.
 * "debug" satisfies a `required` rule and tells a later reviewer nothing, and
 * these grants are reviewed periodically by someone who was not in the room.
 *
 * This is also the one place tenant_id legitimately arrives in a request body.
 * Everywhere else in the API it comes from the host or the session — but a
 * cross-tenant control surface has no host to read it from, and the operator is
 * naming the clinic they are asking about. Authorisation does not depend on it:
 * the policy grants the ABILITY to request, and the grant that results is
 * notified to the named clinic, which is what makes a wrong or malicious value
 * visible rather than useful.
 *
 * @see docs/50-security-compliance/rbac-matrix.md break-glass section
 */
class StoreBreakGlassGrantRequest extends FormRequest
{
    use RejectsUnknownFields;

    /** The shortest reason a reviewer could act on. */
    public const MIN_REASON_LENGTH = 20;

    /** BreakGlassGrantPolicy holds the default-deny answer; the controller consults it. */
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
            'tenant_id' => ['required', 'string', 'ulid', Rule::exists('tenants', 'id')],
            'reason' => ['required', 'string', 'min:'.self::MIN_REASON_LENGTH, 'max:1000'],
            'scope' => ['required', 'string', Rule::in(BreakGlassGrant::SCOPES)],

            // The time box, both ends of it. A grant that starts in the past
            // would be retrospective authorisation, and one that outruns the
            // maximum is standing access wearing an exception's costume.
            'expires_at' => [
                'required',
                'date',
                'after:now',
                'before_or_equal:'.Date::now()->addHours(BreakGlassGrant::MAX_DURATION_HOURS)->toDateTimeString(),
            ],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'reason.required' => 'State why this access is needed. A grant without a recorded reason is '
                .'processing a clinic\'s records without an instruction from the controller.',
            'reason.min' => 'Write a reason a reviewer who was not involved could act on.',
            'scope.in' => 'State which records are in scope, using one of the defined scopes.',
            'expires_at.before_or_equal' => 'A grant may run for at most '
                .BreakGlassGrant::MAX_DURATION_HOURS.' hours. A longer investigation issues a second grant.',
        ];
    }

    public function tenantId(): string
    {
        return (string) $this->validated('tenant_id');
    }

    public function reason(): string
    {
        return (string) $this->validated('reason');
    }

    public function scope(): string
    {
        return (string) $this->validated('scope');
    }

    public function expiresAt(): Carbon
    {
        return Date::parse((string) $this->validated('expires_at'));
    }
}
