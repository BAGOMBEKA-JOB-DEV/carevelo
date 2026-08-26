<?php

namespace App\Http\Requests\V1\Reads;

use App\Http\Requests\Concerns\RejectsUnknownFields;
use App\Http\Requests\V1\Reads\Concerns\ResolvesClinicDays;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Http\FormRequest;

/**
 * The window for GET /v1/revenue.
 *
 * The window is over CONFIRMATIONS, not over bookings. A collection opened on
 * 31 July and confirmed by the aggregator on 1 August belongs to August here,
 * because the only event this endpoint can honestly place on a calendar is the
 * moment the aggregator said the collection completed. `from` and `to` are
 * therefore read as `confirmed_from` and `confirmed_to`, and the resource says
 * so in those words.
 *
 * DEFAULTS TO THE CLINIC'S CURRENT MONTH. "What did we take this month?" is the
 * question the screen exists to answer, so an administrator who sends no
 * parameters gets that month rather than every record the clinic has ever had.
 * `to` defaults to today rather than to the end of the month, because a range
 * running into the future would invite the reader to treat an empty tail as a
 * bad week rather than as days that have not happened.
 *
 * The days are resolved in the CLINIC'S timezone via ResolvesClinicDays, which
 * is the same trait the reconciliation export uses -- one day-resolution rule
 * for the whole payments surface, and the timezone comes from the tenant record
 * rather than from the client. A caller who could choose the timezone could
 * choose which day a payment falls in, and therefore which month's figure it
 * lands in.
 *
 * @see docs/10-product/prd-h5-payments-non-custodial.md
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 */
class IndexRevenueRequest extends FormRequest
{
    use RejectsUnknownFields;
    use ResolvesClinicDays;

    public const DEFAULT_PER_PAGE = 50;

    public const MAX_PER_PAGE = 200;

    /**
     * A year and a day at a time.
     *
     * Long enough for "this year against last year", which is a real question a
     * clinic owner asks, and short enough that the aggregate cannot become an
     * unbounded scan of every payment record the clinic holds. The cap is
     * enforced by the controller, where the resolved dates exist -- the same
     * place and for the same reason as ReconciliationExport::MAX_DAYS.
     */
    public const MAX_DAYS = 366;

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            'from' => ['sometimes', 'date_format:Y-m-d'],
            'to' => ['sometimes', 'date_format:Y-m-d', 'after_or_equal:from'],
            'per_page' => ['sometimes', 'integer', 'min:1', 'max:'.self::MAX_PER_PAGE],
            // Opaque, and produced only by this endpoint. There is no `page`
            // and there will not be one: see the controller.
            'cursor' => ['sometimes', 'string'],
        ];
    }

    /** Midnight on the first confirmation day, in the clinic's own timezone. */
    public function from(): CarbonImmutable
    {
        return $this->dayStart('from') ?? $this->clinicToday()->startOfMonth();
    }

    /** The last instant of the last confirmation day, so the range is inclusive. */
    public function to(): CarbonImmutable
    {
        return $this->dayEnd('to') ?? $this->clinicToday()->endOfDay();
    }

    public function timezone(): string
    {
        return $this->clinicTimezone();
    }

    public function perPage(): int
    {
        $perPage = $this->validated('per_page');

        return is_numeric($perPage) ? (int) $perPage : self::DEFAULT_PER_PAGE;
    }
}
