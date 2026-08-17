<?php

namespace App\Http\Requests\V1\Reads;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Http\Requests\V1\Reads\Concerns\ResolvesClinicDays;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Http\FormRequest;

/**
 * Filters for the audit trail.
 *
 * There is no tenant filter here and there could not usefully be one: the
 * clinic's own trail is the only trail row-level security will return.
 *
 * Note what cannot be filtered -- nothing in `metadata`. Querying by metadata
 * value would turn the audit log into a search index over whatever a caller
 * once put there, which is the shape of the problem this log is supposed not to
 * have.
 *
 * @see docs/50-security-compliance/audit-logging.md
 */
class IndexAuditEventRequest extends FormRequest
{
    use RejectsUnknownFields;
    use ResolvesClinicDays;

    public const DEFAULT_PER_PAGE = 50;

    public const MAX_PER_PAGE = 200;

    /** The filters that map straight onto an indexed column. */
    private const EQUALITY_FILTERS = ['action', 'actor_id', 'subject_type', 'subject_id'];

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'action' => ['sometimes', 'string', 'max:64'],
            'actor_id' => ['sometimes', 'string', 'ulid'],
            'subject_type' => ['sometimes', 'string', 'max:64'],
            'subject_id' => ['sometimes', 'string', 'ulid'],
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
            'cursor' => ['sometimes', 'string'],
        ];
    }

    /**
     * The equality filters actually supplied.
     *
     * Returned as one array so the controller can both apply them and record
     * them on the audit event this read itself writes -- the question "what did
     * the administrator go looking for?" is answered by the filters, not by the
     * rows that came back.
     *
     * @return array<string, string>
     */
    public function equalityFilters(): array
    {
        $filters = [];

        foreach (self::EQUALITY_FILTERS as $field) {
            $value = $this->validated($field);

            if (is_string($value) && $value !== '') {
                $filters[$field] = $value;
            }
        }

        return $filters;
    }

    public function from(): ?CarbonImmutable
    {
        return $this->dayStart('from');
    }

    public function to(): ?CarbonImmutable
    {
        return $this->dayEnd('to');
    }

    public function perPage(): int
    {
        $perPage = $this->validated('per_page');

        return is_numeric($perPage) ? (int) $perPage : self::DEFAULT_PER_PAGE;
    }
}
