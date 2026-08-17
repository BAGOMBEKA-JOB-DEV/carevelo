<?php

namespace App\Http\Requests\Platform;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/**
 * Filters for the grant register.
 *
 * The register is read by two different people for two different reasons: a
 * platform reviewer asking whether the count is rising, and a clinic
 * administrator asking what we read and when. Both are answered by the same
 * list, scoped by the policy rather than by these filters.
 */
class IndexBreakGlassGrantRequest extends FormRequest
{
    use RejectsUnknownFields;

    public const DEFAULT_PER_PAGE = 50;

    public const MAX_PER_PAGE = 100;

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
            'tenant_id' => ['sometimes', 'string', 'ulid', Rule::exists('tenants', 'id')],
            'active' => ['sometimes', 'boolean'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
            'cursor' => ['sometimes', 'string'],
        ];
    }

    public function tenantId(): ?string
    {
        $tenantId = $this->validated('tenant_id');

        return is_string($tenantId) ? $tenantId : null;
    }

    public function onlyActive(): bool
    {
        return $this->boolean('active');
    }

    public function perPage(): int
    {
        $perPage = $this->validated('per_page');

        return is_numeric($perPage) ? (int) $perPage : self::DEFAULT_PER_PAGE;
    }
}
