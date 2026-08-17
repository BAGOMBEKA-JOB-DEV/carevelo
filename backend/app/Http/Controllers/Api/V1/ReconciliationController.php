<?php

namespace App\Http\Controllers\Api\V1;

use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Reads\ExportReconciliationRequest;
use App\Models\Appointment;
use App\Models\AppointmentStatus;
use App\Models\AuditEvent;
use App\Models\DispenseOrder;
use App\Models\DispenseOrderStatus;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Models\Tenant;
use App\Services\Reconciliation\ReconciliationExport;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Collection;

/**
 * The daily reconciliation view.
 *
 * CAREVELO RECONCILES RECORDS, NOT MONEY. We cannot see what the clinic
 * received, because the funds never pass through us: the patient pays the
 * aggregator and the aggregator pays the clinic's own account direct. What this
 * view offers is every attempt we recorded, with its aggregator reference, and
 * a flag on the ones that do not look right -- so the administrator can open
 * their own aggregator dashboard with a specific reference in hand. That is the
 * most useful thing we can honestly offer.
 *
 * There is deliberately no total collected, no reconciled figure and no
 * variance. Each would be an assertion about money we have no way to check.
 *
 * @see docs/10-product/prd-h5-payments-non-custodial.md
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 */
class ReconciliationController extends Controller
{
    /** Past this, a collection nobody has confirmed is worth a look. */
    private const STUCK_AFTER_SECONDS = 3_600;

    /** Past this, a timeout has outlived the window in which it might still resolve. */
    private const TIMED_OUT_WINDOW_SECONDS = 86_400;

    public function index(Request $request): JsonResponse
    {
        $this->authorize('reconcile', PaymentIntent::class);

        /** @var array{date?: string} $validated */
        $validated = $request->validate([
            'date' => ['sometimes', 'date_format:Y-m-d'],
        ]);

        // The clinic's own day, not UTC's. A Kampala administrator reconciling
        // "yesterday" means the day they worked.
        $day = CarbonImmutable::parse($validated['date'] ?? 'today', $this->timezone($request))->startOfDay();

        /** @var Collection<int, PaymentIntent> $intents */
        $intents = PaymentIntent::query()
            // Age is computed by the database clock rather than this process's.
            // One authority for time, and it is the one that stamped the rows.
            ->selectRaw('payment_intents.*, extract(epoch from (now() - initiated_at)) as age_seconds')
            ->whereBetween('initiated_at', [$day, $day->addDay()])
            ->orderBy('initiated_at')
            ->get();

        $mismatched = $this->amountMismatchFlags($intents);
        $progressed = $this->payableProgression($intents);

        $rows = $intents->map(function (PaymentIntent $intent) use ($mismatched, $progressed): array {
            return [
                'id' => $intent->id,
                'reference' => $intent->reference,
                // The line to look for on the clinic's own dashboard. The
                // single most useful field in this response.
                'aggregator_reference' => $intent->aggregator_reference,
                'status' => $intent->status->value,
                'amount' => $intent->amount,
                'method' => $intent->method->value,
                'initiated_at' => $intent->initiated_at?->toIso8601String(),
                'resolved_at' => $intent->resolved_at?->toIso8601String(),
                'flags' => $this->flagsFor(
                    $intent,
                    in_array($intent->id, $mismatched, true),
                    $progressed[$intent->id] ?? null,
                ),
            ];
        })->all();

        return new JsonResponse([
            'data' => [
                'date' => $day->toDateString(),
                'intents' => $rows,
            ],
            'meta' => [
                'total' => count($rows),
                'flagged' => count(array_filter($rows, fn (array $row): bool => $row['flags'] !== [])),
                'note' => 'These are the attempts Carevelo recorded and what the aggregator reported '
                    .'about them. Confirm each flagged reference in your own aggregator dashboard.',
            ],
        ]);
    }

    /**
     * The same records as CSV, for the clinic's own books.
     *
     * Every line carries the aggregator's own reference so an administrator can
     * match it against their aggregator dashboard unaided. There is no total and
     * no reconciled figure, for the reason given on this class: we cannot see
     * what the clinic received, and a number implying we can would be worse than
     * no number at all.
     */
    public function export(ExportReconciliationRequest $request, ReconciliationExport $export): Response
    {
        $this->authorize('reconcile', PaymentIntent::class);

        return $export->csv($request->from(), $request->to());
    }

    /**
     * @param  ?bool  $payableProgressed  null when the intent did not succeed
     * @return list<string>
     */
    private function flagsFor(PaymentIntent $intent, bool $amountMismatch, ?bool $payableProgressed): array
    {
        $flags = [];

        // The fraud boundary fired on a callback or a poll. Never auto-accepted.
        if ($amountMismatch) {
            $flags[] = 'amount_mismatch';
        }

        $age = $this->ageInSeconds($intent);

        if ($age >= self::STUCK_AFTER_SECONDS && in_array(
            $intent->status,
            [PaymentIntentStatus::Initiated, PaymentIntentStatus::Pending],
            true,
        )) {
            // A patient who does not know whether they paid.
            $flags[] = 'stuck_pending';
        }

        if ($intent->status === PaymentIntentStatus::TimedOut && $age >= self::TIMED_OUT_WINDOW_SECONDS) {
            $flags[] = 'timed_out_beyond_window';
        }

        if ($intent->status === PaymentIntentStatus::Succeeded && $payableProgressed === false) {
            // Paid, but the appointment or dispense order did not move. Refund
            // or credit is the clinic's decision, executed through the clinic's
            // own aggregator -- never auto-actioned by us.
            $flags[] = 'succeeded_without_progression';
        }

        if ($intent->status === PaymentIntentStatus::Reversed) {
            // Rare, and always human-handled.
            $flags[] = 'reversed';
        }

        return $flags;
    }

    /**
     * Intent ids whose reported amount disagreed with what we stored.
     *
     * Read back from the audit trail rather than from a column, because the
     * mismatch is deliberately NOT a state change: the intent is left exactly
     * as it was, and the event written at the time is the only record that it
     * happened.
     *
     * @param  Collection<int, PaymentIntent>  $intents
     * @return list<string>
     */
    private function amountMismatchFlags(Collection $intents): array
    {
        if ($intents->isEmpty()) {
            return [];
        }

        /** @var list<string> $ids */
        $ids = AuditEvent::query()
            ->where('action', 'payment.amount_mismatch_flagged')
            ->where('subject_type', 'PaymentIntent')
            ->whereIn('subject_id', $intents->pluck('id')->all())
            ->pluck('subject_id')
            ->all();

        return $ids;
    }

    /**
     * Whether each succeeded intent's payable actually moved.
     *
     * @param  Collection<int, PaymentIntent>  $intents
     * @return array<string, bool> keyed by payment intent id
     */
    private function payableProgression(Collection $intents): array
    {
        $succeeded = $intents->filter(
            fn (PaymentIntent $intent): bool => $intent->status === PaymentIntentStatus::Succeeded
        );

        if ($succeeded->isEmpty()) {
            return [];
        }

        $appointments = Appointment::query()
            ->whereIn('id', $this->payableIds($succeeded, 'appointment'))
            ->get()
            ->keyBy('id');

        $orders = DispenseOrder::query()
            ->whereIn('id', $this->payableIds($succeeded, 'dispense_order'))
            ->get()
            ->keyBy('id');

        $progression = [];

        foreach ($succeeded as $intent) {
            $payableId = (string) $intent->payable_id;

            $appointment = $appointments->get($payableId);
            $order = $orders->get($payableId);

            $progression[$intent->id] = match ($intent->payable_type) {
                'appointment' => $appointment instanceof Appointment && $this->appointmentProgressed($appointment),
                'dispense_order' => $order instanceof DispenseOrder && $this->orderProgressed($order),
                // An unknown or missing payable cannot be shown to have moved.
                default => false,
            };
        }

        return $progression;
    }

    /**
     * @param  Collection<int, PaymentIntent>  $intents
     * @return list<string>
     */
    private function payableIds(Collection $intents, string $type): array
    {
        return array_values(
            $intents
                ->filter(fn (PaymentIntent $intent): bool => $intent->payable_type === $type)
                ->map(fn (PaymentIntent $intent): string => (string) $intent->payable_id)
                ->all()
        );
    }

    private function appointmentProgressed(Appointment $appointment): bool
    {
        return ! in_array($appointment->status, [
            AppointmentStatus::AwaitingPayment,
            AppointmentStatus::PaymentFailed,
            AppointmentStatus::Cancelled,
            AppointmentStatus::Expired,
            AppointmentStatus::Abandoned,
        ], true);
    }

    private function orderProgressed(DispenseOrder $order): bool
    {
        return ! in_array($order->status, [
            DispenseOrderStatus::AwaitingPayment,
            DispenseOrderStatus::Priced,
            DispenseOrderStatus::PartiallyPriced,
            DispenseOrderStatus::Cancelled,
            DispenseOrderStatus::Rejected,
        ], true);
    }

    private function ageInSeconds(PaymentIntent $intent): int
    {
        $age = $intent->getAttribute('age_seconds');

        return is_numeric($age) ? (int) $age : 0;
    }

    private function timezone(Request $request): string
    {
        $tenant = $request->attributes->get('tenant');

        return $tenant instanceof Tenant ? (string) $tenant->timezone : 'Africa/Kampala';
    }
}
