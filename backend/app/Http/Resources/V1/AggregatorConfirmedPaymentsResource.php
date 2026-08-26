<?php

namespace App\Http\Resources\V1;

use App\Http\Controllers\Api\V1\RevenueController;
use App\Support\Money;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * What the clinic's own aggregator confirmed as completed. NOT "revenue received".
 *
 * ------------------------------------------------------------------
 * WHY THE NAME OF THIS CLASS, AND OF EVERY FIELD IN IT, IS THE POINT
 *
 * The screen this feeds answers "what did we take?", which three product
 * documents name as the retention-critical question. Until now the platform
 * could not answer it, and RevenuePlaceholder said so out loud rather than
 * drawing a chart: the only figures available were counts of ATTEMPTS, and
 * summing those into "revenue" would have asserted that every attempt reported
 * as succeeded actually reached the clinic's account -- exactly the claim this
 * architecture exists never to make.
 *
 * Pesapal's GetTransactionStatus changed one half of that. A COMPLETED comes
 * back with a confirmation code, and the resolver refuses to record it unless
 * the amount agrees with the amount we asked for. So there is now a real
 * observation to report: the aggregator, holding the clinic's own merchant
 * account, says this collection completed and here is its reference.
 *
 * It changed NOTHING about the other half. Funds never pass through Carevelo,
 * no account exists here for them to pass through, and nobody here can see the
 * clinic's bank account. "The aggregator confirmed it" and "the money arrived"
 * are different statements, and only the first is ours to make.
 *
 * So every figure is prefixed `aggregator_confirmed_`. Not `revenue`, not
 * `received`, not `earned`, not `collected`, not `total` on its own. The prefix
 * names the OBSERVER and the VERB in the same breath, so no field can be read
 * off in isolation and mistaken for a bank figure -- the way
 * ReconciliationExport::COLUMNS deliberately says `requested_amount_minor` and
 * `status_reported` rather than `amount` and `status`.
 *
 * `method_recorded` carries the same discipline in the other direction. It is
 * the method the collection was OPENED with, which is ours; nothing in
 * payment_intents stores the `payment_method` Pesapal reports back, so this
 * resource must not imply that the aggregator confirmed which rail the patient
 * used. `_recorded` is what we wrote down, `_confirmed` is what the aggregator
 * told us -- and the two words are never swapped.
 *
 * The money shape is the house's -- {amount_minor, currency}, whole shillings
 * times one hundred, an integer that no client is invited to add up in a
 * browser. What carries the caveat is the KEY the object hangs from, which is
 * why it is `aggregator_confirmed_total` and never a bare `total`.
 *
 * @see RevenueController
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 * @see frontend/apps/clinic-console/src/domains/payments/components/RevenuePlaceholder.tsx
 */
class AggregatorConfirmedPaymentsResource extends JsonResource
{
    /**
     * Said in words, not in numbers.
     *
     * A count of what was left out would be a second figure on a screen whose
     * whole problem is a figure being trusted too readily -- and the exclusions
     * do not share a date basis with the total anyway: an attempt nobody ever
     * confirmed has no confirmation date to fall inside the window. Naming them
     * plainly tells the administrator what the number is not, without inventing
     * an arithmetic to sit beside it.
     *
     * @var list<string>
     */
    public const DOES_NOT_COUNT = [
        'attempts the aggregator has not confirmed as completed, including every one still pending a patient\'s PIN',
        'attempts the aggregator reported as failed, and attempts that timed out without a later confirmation',
        'confirmations the aggregator afterwards reported as reversed',
        'cash handed over at the clinic and attested by a staff member, which no aggregator ever saw',
        'collections recorded against an aggregator account that is not live, which is test data by definition',
    ];

    /**
     * @param  array{count: int, amount_minor: int}  $confirmed
     * @param  list<array{method_recorded: string, count: int, amount_minor: int}>  $byMethodRecorded
     * @param  list<array{service_id: ?string, service_name: ?string, paid_for: string, count: int, amount_minor: int}>  $byService
     */
    public function __construct(
        private readonly CarbonImmutable $from,
        private readonly CarbonImmutable $to,
        private readonly string $clinicTimezone,
        private readonly array $confirmed,
        private readonly array $byMethodRecorded,
        private readonly array $byService,
        private readonly ?string $byServiceNextCursor,
    ) {
        // There is no single Eloquent model behind this response -- it is three
        // aggregates over the same window -- so the wrapped resource is empty
        // and every value arrives through the constructor, typed.
        parent::__construct([]);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            // The window is over CONFIRMATIONS. Named so a reader cannot take it
            // for the window in which the appointments were booked, which would
            // put a payment in the wrong month at every month boundary.
            'confirmed_from' => $this->from->toDateString(),
            'confirmed_to' => $this->to->toDateString(),
            // Stated rather than assumed. The dates above are the clinic's own
            // days, and a client rendering them in the browser's timezone would
            // silently disagree with the figure beside them.
            'clinic_timezone' => $this->clinicTimezone,

            'aggregator_confirmed_count' => $this->confirmed['count'],
            'aggregator_confirmed_total' => Money::of($this->confirmed['amount_minor']),

            'by_method_recorded' => array_map(
                fn (array $row): array => [
                    'method_recorded' => $row['method_recorded'],
                    'aggregator_confirmed_count' => $row['count'],
                    'aggregator_confirmed_total' => Money::of($row['amount_minor']),
                ],
                $this->byMethodRecorded,
            ),

            'by_service' => array_map(
                fn (array $row): array => [
                    // Null when the confirmed payment was not for a bookable
                    // service -- a dispensing order has none -- or when the
                    // service row it named no longer exists. Null is not zero
                    // and is not "other": it is the absence of a service, and
                    // `paid_for` says which of the two it was.
                    'service_id' => $row['service_id'],
                    'service_name' => $row['service_name'],
                    'paid_for' => $row['paid_for'],
                    'aggregator_confirmed_count' => $row['count'],
                    'aggregator_confirmed_total' => Money::of($row['amount_minor']),
                ],
                $this->byService,
            ),
        ];
    }

    /**
     * @return array<string, mixed>
     */
    public function with(Request $request): array
    {
        return [
            'meta' => [
                'counts' => 'Payments the clinic\'s own aggregator confirmed as completed, placed on the date '
                    .'it confirmed them, in the clinic\'s own timezone.',

                'does_not_count' => self::DOES_NOT_COUNT,

                // The sentence the whole endpoint exists to keep true. It is in
                // the payload rather than only in the documentation because the
                // payload is what a clinic owner's screen is built from, and a
                // caveat nobody ships is a caveat nobody reads.
                'not_money_in_the_bank' => 'Money never passes through Carevelo and we cannot see the clinic\'s '
                    .'bank account. Every figure here is the aggregator\'s own report about the clinic\'s own '
                    .'collections -- not confirmation that the funds have arrived. Each confirmation carries an '
                    .'aggregator reference in the reconciliation view; check them against your aggregator '
                    .'dashboard, which is the only place that can tell you what actually landed.',

                // Cursor, never an offset page number. Null on the last page.
                'by_service_next_cursor' => $this->byServiceNextCursor,
            ],
        ];
    }
}
