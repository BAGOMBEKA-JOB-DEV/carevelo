<?php

namespace App\Services\Reconciliation;

use App\Audit\AuditLog;
use App\Models\PaymentIntent;
use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Response;
use Illuminate\Validation\ValidationException;
use RuntimeException;

/**
 * The clinic's payment records as CSV, for the clinic's own books.
 *
 * CAREVELO RECONCILES RECORDS, NOT MONEY. The funds never pass through us --
 * the patient pays the aggregator and the aggregator pays the clinic's account
 * direct -- so we cannot see what the clinic received and this file must not
 * imply otherwise. Hence no total, no reconciled figure, no variance and no
 * column that sounds like one: every such number would be an assertion about
 * money we have no way to check, and a clinic that trusted it would be
 * reconciling against fiction.
 *
 * What the file does carry is the aggregator's own reference on every line, so
 * an administrator can match each row against their aggregator dashboard
 * unaided. That is the most useful thing we can honestly offer, and the column
 * names say exactly whose claim each value is.
 *
 * @see docs/10-product/prd-h5-payments-non-custodial.md
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 */
class ReconciliationExport
{
    /**
     * The header row.
     *
     * `requested_amount_minor` rather than `amount`: it is what we asked the
     * aggregator to collect, not what anyone confirms landed. `status_reported`
     * rather than `status`: it is the aggregator's account of the attempt.
     *
     * @var list<string>
     */
    public const COLUMNS = [
        'payment_reference',
        'aggregator_reference',
        'status_reported',
        'requested_amount_minor',
        'currency',
        'method',
        'payable_type',
        'payable_id',
        'initiated_at',
        'resolved_at',
    ];

    /** A quarter at a time. Longer belongs in the tenant data export. */
    public const MAX_DAYS = 92;

    public function __construct(protected AuditLog $audit) {}

    /**
     * @throws ValidationException when the requested range is too wide
     */
    public function csv(CarbonImmutable $from, CarbonImmutable $to): Response
    {
        if ($from->diffInDays($to) > self::MAX_DAYS) {
            throw ValidationException::withMessages([
                'to' => sprintf(
                    'Export at most %d days at a time. A longer history is available through '
                    .'the clinic data export.',
                    self::MAX_DAYS,
                ),
            ]);
        }

        /** @var Collection<int, PaymentIntent> $intents */
        $intents = PaymentIntent::query()
            ->whereBetween('initiated_at', [$from, $to])
            ->orderBy('initiated_at')
            ->orderBy('id')
            ->get();

        // Built in memory rather than streamed. A streamed response is written
        // after the middleware stack has unwound, and the tenant setting is
        // transaction-scoped -- the query would run with no tenant bound, RLS
        // would match nothing, and the clinic would silently download an empty
        // file. The range cap above is what keeps this bounded.
        $body = $this->render($intents);

        // A bulk export of commercial records leaving the platform. Row counts
        // and dates only; the file's contents stay in the file.
        $this->audit->record('reconciliation.exported', metadata: [
            'from' => $from->toDateString(),
            'to' => $to->toDateString(),
            'rows' => $intents->count(),
        ]);

        return new Response($body, 200, [
            'Content-Type' => 'text/csv; charset=UTF-8',
            'Content-Disposition' => sprintf(
                'attachment; filename="payment-records-%s-to-%s.csv"',
                $from->toDateString(),
                $to->toDateString(),
            ),
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /**
     * @param  Collection<int, PaymentIntent>  $intents
     */
    private function render(Collection $intents): string
    {
        $handle = fopen('php://temp', 'r+');

        if ($handle === false) {
            throw new RuntimeException('Could not open a buffer for the reconciliation export.');
        }

        fputcsv($handle, self::COLUMNS);

        foreach ($intents as $intent) {
            fputcsv($handle, $this->row($intent));
        }

        rewind($handle);

        $csv = stream_get_contents($handle);

        fclose($handle);

        return $csv === false ? '' : $csv;
    }

    /**
     * @return list<string>
     */
    private function row(PaymentIntent $intent): array
    {
        return [
            $intent->reference,
            $intent->aggregator_reference ?? '',
            $intent->status->value,
            (string) $intent->amount->amountMinor,
            $intent->amount->currency->value,
            $intent->method->value,
            (string) $intent->getAttribute('payable_type'),
            (string) $intent->getAttribute('payable_id'),
            $intent->initiated_at?->toIso8601String() ?? '',
            $intent->resolved_at?->toIso8601String() ?? '',
        ];
    }
}
