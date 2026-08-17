<?php

namespace App\Http\Requests\V1\Deliveries;

use App\Models\ClinicalRole;
use App\Models\User;
use App\Tenancy\TenantContext;
use Closure;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Handing a delivery to a named rider.
 *
 * The rider is validated here rather than in the controller because
 * "is this person a rider of this clinic" is a property of the input. Users are
 * deliberately NOT row-level-security scoped -- authentication has to find a
 * user before a tenant exists -- so the tenant check on the chosen rider is
 * explicit and cannot be assumed from the database.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 */
class AssignRiderRequest extends FormRequest
{
    /** Authorisation is the controller's policy call; shaping input is this class's job. */
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'rider_id' => ['required', 'string', 'ulid', $this->riderOfThisClinic()],
        ];
    }

    public function riderId(): string
    {
        return (string) $this->validated('rider_id');
    }

    /**
     * One message for every failure mode.
     *
     * "No such user", "user of another clinic" and "not a rider" are answered
     * identically on purpose: a distinguishable response turns this field into
     * a directory of other clinics' staff.
     */
    private function riderOfThisClinic(): Closure
    {
        return function (string $attribute, mixed $value, Closure $fail): void {
            $rider = is_string($value) ? User::query()->find($value) : null;

            $isRider = $rider !== null
                && $rider->is_active
                && $rider->belongsToTenant(app(TenantContext::class)->currentOrFail())
                && $rider->hasRole(ClinicalRole::Rider->value);

            if (! $isRider) {
                $fail('That person is not an active rider of this clinic.');
            }
        };
    }
}
