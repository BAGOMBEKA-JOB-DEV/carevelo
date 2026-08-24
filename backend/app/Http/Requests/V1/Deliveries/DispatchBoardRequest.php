<?php

namespace App\Http\Requests\V1\Deliveries;

use App\Models\DeliveryStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Filters for the dispatch board — and, on the same route, for a patient's own
 * deliveries.
 *
 * No tenant filter is accepted, and none is needed: tenant identity comes from
 * the host, and row-level security has already narrowed the table before this
 * query runs. A `tenant_id` parameter here would be a client-controlled
 * authorisation decision.
 *
 * NO `patient_id` FILTER EITHER, AND THAT IS NOT AN OVERSIGHT. A delivery does
 * not carry a patient identifier — it names a dispense order, and ownership
 * resolves one hop away through it (see `Delivery::restrictToPatient()`). Staff
 * who want one patient's deliveries reach them through that patient's orders,
 * and a patient's listing is already narrowed to their own records by
 * `AuthorisesPatientReads` before any filter could apply.
 *
 * `cursor` IS ACCEPTED THOUGH ONLY ONE OF THE TWO LISTINGS PAGES BY IT. The
 * patient's listing uses `cursorPaginate()`, which is the house rule; the board
 * still pages by offset because the clinic console reads `meta.total` to warn a
 * pharmacist that a lane has overflowed, and a cursor paginator produces no
 * total. `DeliveryController::index()` has the whole argument.
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
            // Opaque and never parsed here. It is read by cursorPaginate() and
            // handed straight back out again.
            'cursor' => ['sometimes', 'string'],
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
