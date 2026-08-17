<?php

namespace App\Http\Requests\V1\Reads;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Http\Requests\V1\Reads\Concerns\ResolvesClinicDays;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The date range for the reconciliation export.
 *
 * Defaults to today rather than to everything. An administrator who forgets the
 * parameter gets the day they are working on, not a file containing every
 * payment record the clinic has ever had.
 *
 * @see docs/10-product/prd-h5-payments-non-custodial.md
 */
class ExportReconciliationRequest extends FormRequest
{
    use RejectsUnknownFields;
    use ResolvesClinicDays;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
        ];
    }

    public function from(): CarbonImmutable
    {
        return $this->dayStart('from') ?? $this->clinicToday();
    }

    /** A `from` with no `to` means that single day, which is what was asked. */
    public function to(): CarbonImmutable
    {
        return $this->dayEnd('to') ?? $this->from()->endOfDay();
    }
}
