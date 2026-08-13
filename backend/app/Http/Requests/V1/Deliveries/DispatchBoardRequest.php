<?php

namespace App\Http\Requests\V1\Deliveries;

use App\Models\DeliveryStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Filters for the dispatch board.
 *
 * No tenant filter is accepted, and none is needed: tenant identity comes from
 * the host, and row-level security has already narrowed the table before this
 * query runs. A `tenant_id` parameter here would be a client-controlled
 * authorisation decision.
 *
 * @see docs/30-architecture/multi-tenancy.md
 */
class DispatchBoardRequest extends FormRequest
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
            'status' => ['sometimes', 'string', Rule::enum(DeliveryStatus::class)],
            'rider_id' => ['sometimes', 'string', 'ulid'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:100'],
        ];
    }

    public function statusFilter(): ?DeliveryStatus
    {
        $status = $this->validated('status');

        return is_string($status) ? DeliveryStatus::from($status) : null;
    }

    public function riderFilter(): ?string
    {
        $riderId = $this->validated('rider_id');

        return is_string($riderId) ? $riderId : null;
    }

    public function perPage(): int
    {
        $perPage = $this->validated('per_page');

        return is_int($perPage) ? $perPage : 25;
    }
}
