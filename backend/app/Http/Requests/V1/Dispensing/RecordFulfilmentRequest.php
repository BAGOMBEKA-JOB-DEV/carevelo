<?php

namespace App\Http\Requests\V1\Dispensing;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * How the patient wants their medicines: collected, or delivered.
 *
 * Two values and no default. A default here would be a guess about something the
 * patient has to be asked -- and if the guess were `delivery`, it would be a
 * guess that their address may be shared with a rider.
 *
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md
 */
class RecordFulfilmentRequest extends FormRequest
{
    use RejectsUnknownFields;

    public const PICKUP = 'pickup';

    public const DELIVERY = 'delivery';

    /** Authorisation is the controller's policy call; shaping input is this class's job. */
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
            'method' => ['required', 'string', Rule::in([self::PICKUP, self::DELIVERY])],
        ];
    }

    public function method(): string
    {
        return (string) $this->validated('method');
    }

    public function wantsDelivery(): bool
    {
        return $this->method() === self::DELIVERY;
    }
}
