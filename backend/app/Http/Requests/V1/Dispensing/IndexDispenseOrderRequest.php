<?php

namespace App\Http\Requests\V1\Dispensing;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Models\DispenseOrderStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Filters for the pharmacy queue.
 *
 * No tenant filter appears here or anywhere else: tenant identity comes from
 * the host or the session, never from a query string, and row-level security
 * does the scoping.
 *
 * @see docs/40-api/api-conventions.md
 */
class IndexDispenseOrderRequest extends FormRequest
{
    use RejectsUnknownFields;

    public const DEFAULT_PER_PAGE = 25;

    public const MAX_PER_PAGE = 100;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'status' => ['sometimes', Rule::enum(DispenseOrderStatus::class)],
            'patient_id' => ['sometimes', 'string', 'ulid'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
            'page' => ['sometimes', 'integer', 'min:1'],
        ];
    }

    public function status(): ?DispenseOrderStatus
    {
        $status = $this->validated('status');

        return is_string($status) ? DispenseOrderStatus::from($status) : null;
    }

    public function patientId(): ?string
    {
        $patientId = $this->validated('patient_id');

        return is_string($patientId) ? $patientId : null;
    }

    public function perPage(): int
    {
        $perPage = $this->validated('per_page');

        return is_numeric($perPage) ? (int) $perPage : self::DEFAULT_PER_PAGE;
    }
}
