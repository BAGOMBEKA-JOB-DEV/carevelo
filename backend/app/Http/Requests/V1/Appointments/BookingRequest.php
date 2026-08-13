<?php

namespace App\Http\Requests\V1\Appointments;

use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

/**
 * Base for the appointment write requests.
 *
 * Authorisation is deliberately NOT decided here. Every endpoint in this API
 * consults a default-deny policy through $this->authorize() in the controller,
 * and a second, weaker gate in the form request is the kind of duplication that
 * eventually disagrees with the policy.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 */
abstract class BookingRequest extends FormRequest
{
    /**
     * @return array<string, mixed>
     */
    abstract public function rules(): array;

    /**
     * @return list<Closure(Validator): void>
     */
    public function after(): array
    {
        return [
            function (Validator $validator): void {
                $this->rejectUnknownFields($validator);
            },
        ];
    }

    /**
     * Reject body fields the endpoint does not know about.
     *
     * Laravel's default is to discard them silently, which is how a clinic
     * discovers six weeks later that a mistyped field was never saved. An
     * explicit error costs one support call now rather than a data-quality
     * investigation later.
     *
     * @see docs/40-api/api-conventions.md
     */
    protected function rejectUnknownFields(Validator $validator): void
    {
        /** @var array<string, mixed> $body */
        $body = $this->all();

        $unknown = array_diff(array_keys($body), array_keys($this->rules()));

        foreach ($unknown as $field) {
            $validator->errors()->add(
                (string) $field,
                'This endpoint does not accept a field called that.',
            );
        }
    }
}
