<?php

namespace App\Http\Requests\V1\Rider;

use App\Http\Controllers\Api\V1\RiderDeliveryController;
use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * What a rider may ask their own list for.
 *
 * ==================================================================
 * TWO VALUES, NOT THE DELIVERY STATUS ENUM, AND THAT IS THE DECISION
 * ==================================================================
 *
 * The obvious filter here is `?status=delivered` against `DeliveryStatus`, and it
 * is the wrong one. `DeliveryStatus` is the DISPATCH BOARD's vocabulary: it has
 * seven cases, four of which describe where a delivery sits in the clinic's own
 * workflow rather than in a rider's day, and publishing it here would let the
 * least-trusted actor in the system compose questions the screen has no answer
 * for — "which of my deliveries are unassigned", say, which is a question about
 * work being taken away from somebody.
 *
 * So this endpoint publishes exactly two answers, which are exactly the two tabs
 * the rider app has: the round in front of you, and what you finished recently.
 * `RiderDeliveryController` maps each onto a set of statuses, and the mapping
 * lives there with the disclosure window it belongs to.
 *
 * `active` IS THE DEFAULT AND THE DEFAULT IS THE OLD BEHAVIOUR. A client that
 * sends nothing gets precisely what it got before this parameter existed —
 * assigned, picked up, en route, oldest first. Nothing already deployed changes.
 *
 * @see RiderDeliveryController::index()
 * @see docs/50-security-compliance/data-protection-dppa.md — "The rider rule"
 */
class RiderAssignmentsRequest extends FormRequest
{
    use RejectsUnknownFields;

    /** The round in front of the rider: assigned, picked up, en route. */
    public const ACTIVE = 'active';

    /** Recently finished work: delivered, failed, returned to the pharmacy. */
    public const COMPLETED = 'completed';

    /** A screenful on a phone. The rider app pages by cursor from here. */
    public const DEFAULT_PER_PAGE = 25;

    /**
     * Lower than the API's usual 100, deliberately.
     *
     * This is a phone in the road on mobile data, and every row carries a
     * recipient's name, telephone number and street address. A page size is a
     * disclosure quantity as well as a payload size, and there is no screen here
     * that shows fifty deliveries at once.
     */
    public const MAX_PER_PAGE = 50;

    /** Authorisation is the controller's business; shaping input is this class's. */
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
            'status' => ['sometimes', Rule::in([self::ACTIVE, self::COMPLETED])],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
            // Opaque. Read by cursorPaginate() and handed straight back out; never
            // parsed, incremented or constructed by anybody.
            'cursor' => ['sometimes', 'string'],
        ];
    }

    /** True when the rider is asking for work they have already finished. */
    public function wantsCompleted(): bool
    {
        return $this->validated('status') === self::COMPLETED;
    }

    public function perPage(): int
    {
        $perPage = $this->validated('per_page');

        return is_numeric($perPage) ? (int) $perPage : self::DEFAULT_PER_PAGE;
    }
}
