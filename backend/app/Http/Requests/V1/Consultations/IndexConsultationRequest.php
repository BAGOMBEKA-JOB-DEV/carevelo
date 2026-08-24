<?php

namespace App\Http\Requests\V1\Consultations;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Models\ConsultationOutcome;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;
use Illuminate\Validation\Rule;

/**
 * Filters for the consultation list.
 *
 * Every filterable and sortable field is on an explicit allow-list, exactly as
 * on the appointment list: a query assembled from arbitrary client input is SQL
 * injection wearing a REST costume, and an unindexed sort on a database several
 * clinics share is a denial of service for all of them.
 *
 * No tenant filter appears here or anywhere else. Tenancy comes from the host
 * or the session, and row-level security does the scoping.
 *
 * `outcome` is filterable because it is already published on the resource, so
 * filtering on it discloses nothing a caller entitled to the list cannot
 * already read. Nothing clinical is filterable, because nothing clinical is on
 * the resource -- notes have their own audited endpoint.
 *
 * @see docs/40-api/api-conventions.md
 */
class IndexConsultationRequest extends FormRequest
{
    use RejectsUnknownFields;

    public const SORTS = ['started_at', '-started_at'];

    /** Cursor pagination, default 25, maximum 100. */
    public const DEFAULT_PER_PAGE = 25;

    public const MAX_PER_PAGE = 100;

    /** Authorisation is the policy's job, consulted in the controller. */
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
            'patient_id' => ['sometimes', 'string', 'ulid'],
            'clinician_id' => ['sometimes', 'string', 'ulid'],
            'outcome' => ['sometimes', Rule::enum(ConsultationOutcome::class)],
            'from' => ['sometimes', 'date'],
            'to' => ['sometimes', 'date', 'after_or_equal:from'],
            'sort' => ['sometimes', Rule::in(self::SORTS)],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
            'cursor' => ['sometimes', 'string'],
        ];
    }

    public function patientId(): ?string
    {
        $patientId = $this->validated('patient_id');

        return is_string($patientId) ? $patientId : null;
    }

    public function clinicianId(): ?string
    {
        $clinicianId = $this->validated('clinician_id');

        return is_string($clinicianId) ? $clinicianId : null;
    }

    public function outcome(): ?ConsultationOutcome
    {
        $outcome = $this->validated('outcome');

        return is_string($outcome) ? ConsultationOutcome::from($outcome) : null;
    }

    /** The start of the date window, inclusive. */
    public function from(): ?Carbon
    {
        $from = $this->validated('from');

        return is_string($from) ? Date::parse($from)->startOfDay() : null;
    }

    /**
     * The end of the date window, inclusive.
     *
     * Extended to the end of the day, matching the appointment list: a clinic
     * asking for "to=2026-08-20" means the whole of the 20th, not midnight at
     * the start of it.
     */
    public function to(): ?Carbon
    {
        $to = $this->validated('to');

        return is_string($to) ? Date::parse($to)->endOfDay() : null;
    }

    /**
     * Newest first unless asked otherwise.
     *
     * A consultation list is read to answer "what happened recently", so the
     * default that needs no query string is the useful one.
     */
    public function sortsAscending(): bool
    {
        return $this->validated('sort') === 'started_at';
    }

    public function perPage(): int
    {
        $perPage = $this->validated('per_page');

        return is_numeric($perPage) ? (int) $perPage : self::DEFAULT_PER_PAGE;
    }
}
