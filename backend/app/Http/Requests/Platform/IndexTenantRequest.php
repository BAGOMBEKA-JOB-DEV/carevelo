<?php

namespace App\Http\Requests\Platform;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Models\TenantStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Filters for the tenant register.
 *
 * Every filterable field is on an explicit allow-list, as everywhere else in
 * this API: building a query from arbitrary client input is SQL injection
 * wearing a REST costume.
 *
 * @see docs/40-api/api-conventions.md
 */
class IndexTenantRequest extends FormRequest
{
    use RejectsUnknownFields;

    public const DEFAULT_PER_PAGE = 50;

    public const MAX_PER_PAGE = 100;

    /** TenantPolicy holds the default-deny answer; the controller consults it. */
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
            'status' => ['sometimes', Rule::enum(TenantStatus::class)],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
            'cursor' => ['sometimes', 'string'],
        ];
    }

    public function status(): ?TenantStatus
    {
        $status = $this->validated('status');

        return is_string($status) ? TenantStatus::from($status) : null;
    }

    public function perPage(): int
    {
        $perPage = $this->validated('per_page');

        return is_numeric($perPage) ? (int) $perPage : self::DEFAULT_PER_PAGE;
    }
}
