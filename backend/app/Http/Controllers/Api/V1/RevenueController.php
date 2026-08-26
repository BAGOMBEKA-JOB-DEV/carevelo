<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Reads\IndexRevenueRequest;
use App\Http\Resources\V1\AggregatorConfirmedPaymentsResource;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Models\PaymentMethod;
use Carbon\CarbonImmutable;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Database\Eloquent\Builder as EloquentBuilder;
use Illuminate\Database\Query\Builder as QueryBuilder;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * The one figure the platform can honestly produce, and what it is not.
 *
 * ------------------------------------------------------------------
 * WHAT CHANGED, AND WHAT DID NOT
 *
 * RevenuePlaceholder in the clinic console has been refusing to draw this
 * screen, and its argument was right at the time: the only figures the platform
 * held were counts of ATTEMPTS, and adding those up would have asserted that
 * every attempt reported as succeeded reached the clinic's account -- a
 * plausible, precise, confidently-rendered number that nobody could stand
 * behind, which a clinic owner would then make decisions on.
 *
 * Pesapal's GetTransactionStatus supplies the missing observation. A COMPLETED
 * arrives with a confirmation code, and PaymentIntentResolver refuses to record
 * it unless the reported amount agrees with the amount we asked to be
 * collected -- the fraud boundary that keeps a forged or replayed payload from
 * confirming a large booking against a small payment. An intent that reaches
 * `succeeded` through an aggregator therefore stands for something real: the
 * clinic's own aggregator says that collection completed, for that amount.
 *
 * NOTHING changed about custody. The patient pays the aggregator, the
 * aggregator pays the clinic's own account direct, and no account exists here
 * for the money to pass through. Nobody at Carevelo can see the clinic's bank
 * account, so "the aggregator confirmed it" and "the money arrived" remain
 * different statements and only the first is ours to make. Every field name in
 * the response carries that distinction; see
 * AggregatorConfirmedPaymentsResource, where it is the whole subject.
 *
 * ------------------------------------------------------------------
 * WHAT IS COUNTED
 *
 * `status = succeeded`, and only through an aggregator. Four exclusions fall
 * out of that one rule and each matters on its own:
 *
 * - `pending` and `initiated` are the NORMAL state of mobile money, not an edge
 *   case -- the patient has to pick up a handset and type a PIN, and may not.
 *   Counting them would put money in a month on the strength of a push
 *   notification.
 * - `failed` and `timed_out` are self-evident, except that `timed_out` is NOT
 *   final: a late confirmation can still move it to `succeeded`, at which point
 *   it starts counting. This month's figure can therefore rise slightly after
 *   the month ends, and that is correct rather than a defect.
 * - `reversed` is excluded because a reversal is the clinic's own aggregator
 *   moving money back. Carevelo cannot reverse anything -- it holds nothing to
 *   reverse from -- so the row is a note that the clinic did, and a note that
 *   money went back is not a takings figure.
 * - `cash_at_clinic` is excluded because NO AGGREGATOR EVER SAW IT. It is a
 *   named staff member's attestation that a patient handed over notes, which is
 *   the clinic's own internal control and audited as one. It is real money and
 *   it is not this endpoint's claim to make; folding it in would put an
 *   unverified assertion under a heading that says the aggregator confirmed it.
 *
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 * @see docs/30-architecture/frontend-nextjs.md -- acceptance criterion 9
 */
class RevenueController extends Controller
{
    /**
     * The only aggregator environment whose confirmations are real money.
     *
     * THIS IS THE "EXCLUDES TEST DATA" CONTROL. A clinic finishing onboarding
     * runs its own merchant account in the aggregator's sandbox, where a
     * COMPLETED is a rehearsal: the confirmation code is real, the amount is
     * real, and no shilling moved. Those intents are indistinguishable from
     * live ones on the payment_intents row itself, so the environment is read
     * off the clinic's own aggregator account -- the same row PaymentIntent
     * records the provider from, matched per provider so a clinic that moved
     * between aggregators is judged on the account the attempt actually used.
     *
     * The direction of failure is the safe one while it matters: a clinic still
     * in sandbox has NO live account, so nothing counts and the screen reads
     * zero rather than reading a rehearsal as takings.
     *
     * THE RESIDUAL GAP, STATED RATHER THAN HIDDEN. The environment is read as it
     * stands today, not as it stood when the collection was opened, because
     * nothing stamps it on the intent. A clinic that rehearsed in sandbox and
     * then went live would see its rehearsals counted from the moment it
     * flipped. Closing that properly needs a column on payment_intents written
     * at initiation, which is a migration in the payments domain and not this
     * endpoint's to add. Until then this is the honest available signal and the
     * limitation belongs in the open.
     */
    private const LIVE_ENVIRONMENT = 'live';

    /**
     * GET /v1/revenue?from&to
     *
     * ClinicAdmin only, through `PaymentIntentPolicy::reconcile` -- the same
     * gate as the reconciliation view it sits beside, deliberately reusing that
     * ability rather than inventing a second one that could drift from it. A
     * clinic's whole takings are a commercial view of the business; a
     * pharmacist and a front-desk clerk have no business in it even though both
     * may take a payment.
     *
     * A denial here is 403, not 404. That is not in tension with the house rule
     * that cross-tenant reads are 404: the caller is inside their own clinic and
     * the endpoint's existence is not a secret from them -- what they lack is
     * the role. A request from outside the tenant never reaches this method at
     * all, because ResolveTenant answers an unrecognised host with a neutral 404
     * and row-level security means another clinic's confirmations are not in the
     * query's result set to be leaked.
     */
    public function index(IndexRevenueRequest $request): AggregatorConfirmedPaymentsResource
    {
        $this->authorize('reconcile', PaymentIntent::class);

        $from = $request->from();
        $to = $request->to();

        $this->assertWindowIsBounded($from, $to);

        $page = $this->byServicePage($from, $to, $request->perPage());

        return new AggregatorConfirmedPaymentsResource(
            $from,
            $to,
            $request->timezone(),
            $this->confirmedTotal($from, $to),
            $this->byMethodRecorded($from, $to),
            $this->serviceRows($page->items()),
            $page->nextCursor()?->encode(),
        );
    }

    /**
     * Every confirmation in the window, and nothing else.
     *
     * One place, used by all three aggregates, so the total and the two
     * breakdowns cannot disagree about what counts. Three near-identical filter
     * lists would eventually differ by one clause and the breakdowns would stop
     * summing to the total -- which is the single most corrosive thing a
     * financial screen can do, because it is visible and unexplainable at once.
     *
     * @return EloquentBuilder<PaymentIntent>
     */
    private function confirmed(CarbonImmutable $from, CarbonImmutable $to): EloquentBuilder
    {
        return PaymentIntent::query()
            ->where('payment_intents.status', PaymentIntentStatus::Succeeded->value)
            // Aggregator-backed only. Cash is a staff attestation, not a
            // confirmation, and the heading on this response says confirmation.
            ->where('payment_intents.method', '!=', PaymentMethod::CashAtClinic->value)
            /*
             * THE DAY BOUNDARY, AND WHY `->utc()` IS LOAD-BEARING.
             *
             * $from and $to are midnight and last-instant in the CLINIC's
             * timezone, which is what an administrator in Kampala means by "this
             * month". Laravel formats a bound DateTimeInterface with the
             * grammar's naive 'Y-m-d H:i:s' and performs NO timezone conversion,
             * and this connection pins the PostgreSQL session to UTC -- so
             * binding the Kampala-midnight value directly would send
             * "2026-08-01 00:00:00" and PostgreSQL would read it as 00:00 UTC,
             * which is 03:00 in Kampala. Three hours of confirmations at each
             * end of the range land in the wrong month, and the clinic's own
             * books disagree with ours by an amount nobody can account for.
             *
             * Converting to UTC first makes the naive string the correct instant
             * under the session timezone the configuration deliberately pins.
             */
            ->where('payment_intents.resolved_at', '>=', $from->utc())
            ->where('payment_intents.resolved_at', '<=', $to->utc())
            // Read as: this attempt was collected through an account the clinic
            // has taken live. See LIVE_ENVIRONMENT. The tenant column is matched
            // as well as the provider -- row-level security already guarantees
            // it, and a join condition that spells out the boundary is one a
            // reviewer can check without holding the RLS policies in their head.
            ->whereExists(fn (QueryBuilder $account) => $account
                ->selectRaw('1')
                ->from('aggregator_accounts')
                ->whereColumn('aggregator_accounts.tenant_id', 'payment_intents.tenant_id')
                ->whereColumn('aggregator_accounts.provider', 'payment_intents.aggregator')
                ->where('aggregator_accounts.environment', self::LIVE_ENVIRONMENT));
    }

    /**
     * The headline pair, over the whole window.
     *
     * Computed by the database over the entire range and never by paging and
     * adding, so it does not move when the caller walks the by-service cursor.
     *
     * @return array{count: int, amount_minor: int}
     */
    private function confirmedTotal(CarbonImmutable $from, CarbonImmutable $to): array
    {
        $row = $this->confirmed($from, $to)
            ->toBase()
            ->selectRaw('count(*) as confirmed_count')
            ->selectRaw('coalesce(sum(payment_intents.amount_minor), 0) as confirmed_amount_minor')
            ->first();

        return [
            'count' => $this->exactInteger($this->column($row, 'confirmed_count')),
            'amount_minor' => $this->exactInteger($this->column($row, 'confirmed_amount_minor')),
        ];
    }

    /**
     * Confirmations grouped by the method the collection was opened with.
     *
     * NOT paginated, and the reason is that the set is closed rather than that
     * it is small. PaymentMethod is an enum of four cases, one of which is
     * excluded here, so this list can never exceed three rows however many
     * payments a clinic takes. A cursor over a fixed enum would be ceremony
     * that gives a client a second page to forget to fetch.
     *
     * `method_recorded`, not `method_confirmed`: this is what WE wrote down when
     * the collection was opened. Pesapal reports a `payment_method` of its own
     * on GetTransactionStatus and nothing stores it, so this breakdown must not
     * be read as the aggregator confirming which rail the patient used.
     *
     * @return list<array{method_recorded: string, count: int, amount_minor: int}>
     */
    private function byMethodRecorded(CarbonImmutable $from, CarbonImmutable $to): array
    {
        $rows = $this->confirmed($from, $to)
            ->toBase()
            ->selectRaw('payment_intents.method as method_recorded')
            ->selectRaw('count(*) as confirmed_count')
            ->selectRaw('coalesce(sum(payment_intents.amount_minor), 0) as confirmed_amount_minor')
            ->groupBy('payment_intents.method')
            ->orderBy('payment_intents.method')
            ->get();

        $breakdown = [];

        foreach ($rows as $row) {
            $breakdown[] = [
                'method_recorded' => (string) $this->column($row, 'method_recorded'),
                'count' => $this->exactInteger($this->column($row, 'confirmed_count')),
                'amount_minor' => $this->exactInteger($this->column($row, 'confirmed_amount_minor')),
            ];
        }

        return $breakdown;
    }

    /**
     * Confirmations grouped by the service that was paid for, one cursor page.
     *
     * CURSOR, NEVER OFFSET -- and not merely because the house rule says so. A
     * clinic's service list is edited while an administrator is reading this
     * screen, and a late confirmation can add a group between two requests. An
     * offset would then repeat one service and skip another, producing a
     * breakdown whose rows are individually correct and whose sum is wrong.
     * There is no version of a money screen where a page is allowed to be wrong.
     *
     * The keyset runs over `group_key`, which is deliberately NEVER NULL: a
     * nullable cursor column silently breaks keyset pagination, because SQL
     * comparisons against NULL are neither true nor false and the row is
     * skipped in both directions. A confirmation for an appointment keys on its
     * service id; everything else keys on a `~`-prefixed payable type, which
     * cannot collide with a ULID.
     *
     * The grouped aggregate is wrapped in a derived table so the cursor's WHERE
     * applies to the finished groups rather than to the rows underneath them.
     * Applied before grouping it would filter payments, not services, and the
     * page would carry the right services with the wrong totals in them.
     *
     * @return CursorPaginator<int, mixed>
     */
    private function byServicePage(CarbonImmutable $from, CarbonImmutable $to, int $perPage): CursorPaginator
    {
        $groups = $this->confirmed($from, $to)
            ->toBase()
            // The payable reference is hand-rolled -- a short type string and an
            // id, with no morphTo to lean on -- so the type is matched in the
            // join condition as well as the id. Without it an appointment id
            // that happened to match a dispense order's would attribute one to
            // the other's service. ULIDs make that unlikely rather than
            // impossible, and "unlikely" is not a correctness argument.
            ->leftJoin('appointments', fn (JoinClause $join) => $join
                ->on('appointments.id', '=', 'payment_intents.payable_id')
                ->where('payment_intents.payable_type', '=', 'appointment')
                ->whereColumn('appointments.tenant_id', 'payment_intents.tenant_id'))
            ->leftJoin('services', fn (JoinClause $join) => $join
                ->on('services.id', '=', 'appointments.service_id')
                ->whereColumn('services.tenant_id', 'appointments.tenant_id'))
            ->selectRaw("coalesce(appointments.service_id::text, '~' || payment_intents.payable_type) as group_key")
            ->selectRaw('appointments.service_id as service_id')
            ->selectRaw('services.name as service_name')
            ->selectRaw('payment_intents.payable_type as paid_for')
            ->selectRaw('count(*) as confirmed_count')
            ->selectRaw('coalesce(sum(payment_intents.amount_minor), 0) as confirmed_amount_minor')
            ->groupBy('appointments.service_id', 'services.name', 'payment_intents.payable_type');

        return DB::query()
            ->fromSub($groups, 'g')
            ->orderBy('g.group_key')
            ->cursorPaginate($perPage, ['*'], 'cursor');
    }

    /**
     * @param  array<int, mixed>  $items
     * @return list<array{service_id: ?string, service_name: ?string, paid_for: string, count: int, amount_minor: int}>
     */
    private function serviceRows(array $items): array
    {
        $rows = [];

        foreach ($items as $item) {
            $serviceId = $this->column($item, 'service_id');
            $serviceName = $this->column($item, 'service_name');

            $rows[] = [
                // Trimmed because the id columns are fixed-width `char`, and a
                // padded ULID does not match the one every other endpoint
                // returns for the same service.
                'service_id' => is_string($serviceId) ? trim($serviceId) : null,
                'service_name' => is_string($serviceName) ? $serviceName : null,
                'paid_for' => (string) $this->column($item, 'paid_for'),
                'count' => $this->exactInteger($this->column($item, 'confirmed_count')),
                'amount_minor' => $this->exactInteger($this->column($item, 'confirmed_amount_minor')),
            ];
        }

        return $rows;
    }

    /**
     * A window wider than a year is refused rather than served slowly.
     *
     * The same shape of cap as ReconciliationExport::MAX_DAYS and for the same
     * reason: an unbounded range turns this into an aggregate over every
     * payment record the clinic has ever held, and the question it would be
     * answering ("what have we ever taken?") is not one anybody asks of a
     * takings screen.
     *
     * @throws ValidationException
     */
    private function assertWindowIsBounded(CarbonImmutable $from, CarbonImmutable $to): void
    {
        if ($from->diffInDays($to) > IndexRevenueRequest::MAX_DAYS) {
            throw ValidationException::withMessages([
                'to' => sprintf(
                    'Ask for at most %d days at a time. A longer history is available through the '
                    .'reconciliation export.',
                    IndexRevenueRequest::MAX_DAYS,
                ),
            ]);
        }
    }

    /**
     * One column off a raw aggregate row.
     *
     * These rows come back from the query builder as stdClass, so there is no
     * model to read them off and nothing static analysis can check about the
     * property names. Reading them in one place keeps the guessing in one place.
     */
    private function column(mixed $row, string $column): mixed
    {
        return is_object($row) && property_exists($row, $column) ? $row->{$column} : null;
    }

    /**
     * A whole number, read exactly, or nothing at all.
     *
     * MINOR UNITS ARE NEVER READ THROUGH A FLOAT. `sum()` over a bigint column
     * returns PostgreSQL `numeric`, which pdo_pgsql hands back as a string;
     * casting that through a float would be exact today and inexact at a size
     * nobody would notice crossing. A shilling figure that is quietly wrong in
     * its last digits is worse than an error, because it is believable.
     *
     * So the string is required to be an integer literal, and anything else
     * raises rather than degrades. This endpoint may decline to answer; it may
     * not answer approximately.
     */
    private function exactInteger(mixed $value): int
    {
        if (is_int($value)) {
            return $value;
        }

        if (is_string($value) && preg_match('/^-?\d+$/', $value) === 1) {
            return (int) $value;
        }

        throw new RuntimeException(
            'A confirmed-payment total came back from the database in a form that cannot be read '
            .'exactly as minor units. Refusing to report an approximate money figure.'
        );
    }
}
