<?php

namespace App\Http\Requests\V1\Appointments;

use App\Models\AppointmentStatus;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;
use Illuminate\Validation\Rule;

/**
 * Filters for the appointment list: status, date window, clinician.
 *
 * Every filterable and sortable field is on an explicit allow-list. Building a
 * query from arbitrary client input is SQL injection wearing a REST costume,
 * and an unindexed sort on a shared database is a denial of service for every
 * other clinic on it.
 *
 * @see docs/40-api/api-conventions.md
 */
class IndexAppointmentRequest extends FormRequest
{
    public const SORTS = ['scheduled_start_at', '-scheduled_start_at'];

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'status' => ['nullable', Rule::enum(AppointmentStatus::class)],
            'clinician_id' => ['nullable', 'string', 'ulid'],
            'from' => ['nullable', 'date'],
            'to' => ['nullable', 'date', 'after_or_equal:from'],
            'sort' => ['nullable', Rule::in(self::SORTS)],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
            'cursor' => ['nullable', 'string'],
        ];
    }

    public function status(): ?AppointmentStatus
    {
        $status = $this->string('status')->toString();

        return $status === '' ? null : AppointmentStatus::from($status);
    }

    public function clinicianId(): ?string
    {
        $id = $this->string('clinician_id')->toString();

        return $id === '' ? null : $id;
    }

    /** The start of the date window, inclusive. */
    public function from(): ?Carbon
    {
        $from = $this->string('from')->toString();

        return $from === '' ? null : Date::parse($from)->startOfDay();
    }

    /**
     * The end of the date window, inclusive.
     *
     * Extended to the end of the day: a clinic asking for "to=2026-08-20" means
     * the whole of the 20th, not midnight at the start of it.
     */
    public function to(): ?Carbon
    {
        $to = $this->string('to')->toString();

        return $to === '' ? null : Date::parse($to)->endOfDay();
    }

    public function sortsDescending(): bool
    {
        return $this->string('sort')->toString() === '-scheduled_start_at';
    }

    public function perPage(): int
    {
        $perPage = $this->integer('per_page');

        return $perPage > 0 ? $perPage : 25;
    }
}
