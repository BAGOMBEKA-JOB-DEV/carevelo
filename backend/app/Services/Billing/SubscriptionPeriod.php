<?php

namespace App\Services\Billing;

use App\Models\Tenant;
use Carbon\CarbonImmutable;
use Carbon\CarbonInterface;

/**
 * The month a subscription charge buys.
 *
 * A tiny type, and it exists because the arithmetic is the part people get
 * wrong. Two rules, both learned from calendars rather than from billing:
 *
 * 1. A new period starts THE DAY AFTER the current one ends, never today. A
 *    clinic that pays early must not lose the days it has already paid for --
 *    which is what starting from `now` would do, silently, in favour of the
 *    vendor.
 *
 * 2. Month arithmetic does not overflow. Adding a month to 31 January gives 28
 *    February, not 3 March. Carbon's plain addMonth() does the second thing, and
 *    a subscription that started on the 31st would drift a day or three later
 *    every month until it landed on the 3rd.
 *
 * Dates rather than instants throughout: a billing period is a calendar fact a
 * human reads on an invoice, and Pesapal's recurring API takes `start_date` and
 * `end_date` as dd-MM-yyyy with no time in them at all.
 */
final readonly class SubscriptionPeriod
{
    private function __construct(
        public CarbonImmutable $startsOn,
        public CarbonImmutable $endsOn,
    ) {}

    /**
     * The next unpaid month for this clinic.
     *
     * Continues from the paid-through date when there is one in the future, and
     * otherwise starts today. A clinic whose period lapsed weeks ago does NOT
     * get billed for the gap: no arrears accrue anywhere in this system, and
     * there is no concept in which they could.
     */
    public static function next(Tenant $tenant, CarbonInterface $now): self
    {
        $paidThrough = $tenant->current_period_ends_at;

        $start = $paidThrough !== null && $paidThrough->isAfter($now)
            ? CarbonImmutable::instance($paidThrough)->addDay()->startOfDay()
            : CarbonImmutable::instance($now)->startOfDay();

        return new self($start, $start->addMonthNoOverflow()->subDay());
    }

    /** Pesapal's format for `subscription_details`, and only Pesapal's. */
    public function pesapalStartDate(): string
    {
        return $this->startsOn->format('d-m-Y');
    }

    public function pesapalEndDate(): string
    {
        return $this->endsOn->format('d-m-Y');
    }

    /**
     * The instant the clinic is paid through.
     *
     * The end of the last day it bought, so a period ending on the 30th does not
     * suspend a clinic at one minute past midnight on the 30th. Stored UTC and
     * rendered in Africa/Kampala, like every other timestamp here.
     */
    public function paidThroughAt(): CarbonImmutable
    {
        return $this->endsOn->endOfDay();
    }
}
