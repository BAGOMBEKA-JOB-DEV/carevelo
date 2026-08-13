<?php

namespace App\Http\Requests\V1\Prescriptions;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Models\PrescriptionStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Filters for the prescription list.
 *
 * No tenant filter appears here or anywhere else: tenant identity comes from
 * the host or the session, and row-level security does the scoping.
 *
 * @see docs/40-api/api-conventions.md
 */
class IndexPrescriptionRequest extends FormRequest
{
    use RejectsUnknownFields;

    /** Cursor pagination, default 25, maximum 100. */
    public const DEFAULT_PER_PAGE = 25;

    public const MAX_PER_PAGE = 100;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'patient_id' => ['sometimes', 'string', 'ulid'],
            'status' => ['sometimes', Rule::enum(PrescriptionStatus::class)],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
            'cursor' => ['sometimes', 'string'],
        ];
    }

    public function patientId(): ?string
    {
        $patientId = $this->validated('patient_id');

        return is_string($patientId) ? $patientId : null;
    }

    public function status(): ?PrescriptionStatus
    {
        $status = $this->validated('status');

        return is_string($status) ? PrescriptionStatus::from($status) : null;
    }

    public function perPage(): int
    {
        $perPage = $this->validated('per_page');

        return is_numeric($perPage) ? (int) $perPage : self::DEFAULT_PER_PAGE;
    }
}
