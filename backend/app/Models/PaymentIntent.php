<?php

namespace App\Models;

use App\Exceptions\StateMachine\IllegalTransition;
use App\Models\Concerns\BelongsToTenant;
use App\Models\Contracts\RestrictableToPatient;
use App\Support\Money;
use Database\Factories\PaymentIntentFactory;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;

/**
 * A RECORD of a payment attempt. Not a payment.
 *
 * The name is deliberate: anyone reading it should be reminded that Carevelo
 * does not effect payments and holds no funds. The patient pays the aggregator,
 * the aggregator settles DIRECTLY to the clinic's own account, and this row
 * records that an attempt was made and what the aggregator said about it.
 *
 * There is no wallet, balance, float, escrow, payout or settlement anywhere in
 * this class or this system. Their absence is a compliance control: custody
 * would trigger the NPS Act 2020 PSP / e-money categories and their
 * UGX 250m-10bn capital requirements.
 *
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 *
 * @property string $id
 * @property string $reference
 * @property PaymentIntentStatus $status
 * @property Money $amount
 * @property string $idempotency_key
 * @property ?Carbon $next_poll_at
 * @property PaymentMethod $method
 * @property ?string $aggregator_reference
 * @property ?string $aggregator_tracking_id
 * @property ?string $redirect_url
 * @property ?string $failure_message
 * @property ?Carbon $resolved_at
 * @property ?Carbon $initiated_at
 */
class PaymentIntent extends Model implements RestrictableToPatient
{
    use BelongsToTenant;

    /** @use HasFactory<PaymentIntentFactory> */
    use HasFactory;

    use HasUlids;

    protected $fillable = [
        'reference', 'payable_type', 'payable_id', 'amount_minor', 'currency',
        'method', 'aggregator', 'aggregator_reference', 'idempotency_key',
        'request_fingerprint', 'stored_response', 'status', 'initiated_at',
        'resolved_at', 'next_poll_at', 'poll_attempts', 'failure_code',
        'failure_message', 'raw_callback_payload',
        // The aggregator's own identifier for a server-side handoff, and the
        // page it sent the patient to. Both are written by us after an
        // initiation and neither is a request field.
        'aggregator_tracking_id', 'redirect_url',
    ];

    /**
     * The graduated poll schedule, in seconds since initiation.
     *
     * A webhook is NEVER the only path to resolution. Missed webhooks are
     * ordinary in this market, and an intent stuck in pending forever is a
     * patient who does not know whether they paid.
     *
     * @see docs/40-api/webhooks.md -- that document is the single source
     */
    public const POLL_SCHEDULE = [
        120 => 60,      // 2-15 min  : every minute
        900 => 300,     // 15-60 min : every 5 minutes
        3600 => 3600,   // over 60 min: hourly, up to 24h
    ];

    /**
     * initiated_at, next_poll_at, resolved_at are timestamptz.
     *
     * Laravel's default format is naive ('Y-m-d H:i:s'), so PostgreSQL resolves
     * the missing offset in the SESSION's timezone rather than the application's.
     * The instant stored then depends on how the database server happens to be
     * configured. What shifts here is reconciliation against the aggregator, and next_poll_at drives the poller -- a shift stalls or hammers it.
     *
     * Columns declared without a timezone ignore the offset, so created_at and
     * updated_at are unaffected.
     *
     * @var string
     */
    protected $dateFormat = 'Y-m-d H:i:sP';

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'status' => PaymentIntentStatus::class,
            'method' => PaymentMethod::class,
            'amount' => Money::class,
            'stored_response' => 'array',
            'raw_callback_payload' => 'array',
            'initiated_at' => 'datetime',
            'resolved_at' => 'datetime',
            'next_poll_at' => 'datetime',
            'poll_attempts' => 'integer',
        ];
    }

    /**
     * The payable types a patient can own, mapped to the model that holds the
     * patient_id.
     *
     * Named here rather than inlined so a test can assert it covers every type
     * the API accepts. A type missing from this map does not leak -- the patient
     * simply never sees those intents -- but it does mean a receipt the patient
     * is entitled to becomes unreachable, and silently.
     *
     * @var array<string, class-string<Appointment|DispenseOrder>>
     */
    public const PATIENT_OWNED_PAYABLES = [
        'appointment' => Appointment::class,
        'dispense_order' => DispenseOrder::class,
    ];

    /**
     * Whose payment attempt this is, resolved through the payable.
     *
     * An intent names what is being paid for, not who is paying, so policies
     * cannot read patient_id off it directly.
     *
     * An unrecognised payable_type yields null rather than an error. The row is
     * then owned by nobody, so a patient is refused it -- the safe direction. A
     * new payable type therefore has to be added to PATIENT_OWNED_PAYABLES to
     * become reachable, and a test asserts that map matches what the API accepts.
     */
    public function patientId(): ?string
    {
        $model = self::PATIENT_OWNED_PAYABLES[(string) $this->payable_type] ?? null;

        if ($model === null) {
            return null;
        }

        $patientId = $model::query()->whereKey($this->payable_id)->value('patient_id');

        // is_string rather than a null check: the payable may not exist, or may be
        // hidden from this session by RLS, and both arrive here as a non-string.
        return is_string($patientId) ? $patientId : null;
    }

    /**
     * Narrow to payment intents for the patient records this account owns.
     *
     * payable_type/payable_id is a hand-rolled polymorphic reference holding
     * short strings rather than class names, and there is no morphTo relation to
     * lean on, so ownership is resolved with one subquery per type.
     *
     * The type is matched as well as the id. Without it an intent of one type
     * would be reachable through an id that happens to match a record of the
     * other -- ULIDs make that unlikely rather than impossible, and "unlikely"
     * is not an access control.
     *
     * @param  Builder<covariant Model>  $query
     */
    public static function restrictToPatient(Builder $query, User $user): void
    {
        $patientIds = $user->ownedPatientIds();

        $query->where(function (Builder $outer) use ($patientIds): void {
            foreach (self::PATIENT_OWNED_PAYABLES as $type => $model) {
                $outer->orWhere(function (Builder $inner) use ($type, $model, $patientIds): void {
                    $inner->where('payable_type', $type)
                        ->whereIn('payable_id', $model::query()
                            ->whereIn('patient_id', $patientIds)
                            ->select('id'));
                });
            }
        });
    }

    /**
     * Resolve as succeeded.
     *
     * Note this is reachable from timed_out: mobile-money confirmations arrive
     * late, and treating a timeout as definitive failure produces the worst
     * outcome available -- a patient charged for a cancelled booking.
     */
    public function markSucceeded(?string $aggregatorReference = null): void
    {
        $this->transitionTo(PaymentIntentStatus::Succeeded);

        if ($aggregatorReference !== null) {
            $this->aggregator_reference = $aggregatorReference;
        }

        $this->resolved_at = Date::now();
        $this->next_poll_at = null;
        $this->save();
    }

    public function markFailed(?string $code = null, ?string $message = null): void
    {
        $this->transitionTo(PaymentIntentStatus::Failed);

        $this->failure_code = $code;
        // Surfaced verbatim from the aggregator: only they know why a
        // mobile-money collection failed, and paraphrasing loses the part the
        // patient can act on.
        $this->failure_message = $message;
        $this->resolved_at = Date::now();
        $this->next_poll_at = null;
        $this->save();
    }

    public function markTimedOut(): void
    {
        $this->transitionTo(PaymentIntentStatus::TimedOut);
        $this->save();
    }

    /**
     * Validate a callback amount against what we recorded.
     *
     * NEVER trust the amount in a callback. Accepting it would let a forged or
     * replayed payload confirm a large booking against a small payment.
     */
    public function amountMatches(int $amountMinor): bool
    {
        return $this->amount_minor === $amountMinor;
    }

    /** Schedule the next reconciliation poll under the graduated schedule. */
    public function scheduleNextPoll(): void
    {
        /** @var Carbon $initiatedAt */
        $initiatedAt = $this->getAttribute('initiated_at');

        $age = (int) $initiatedAt->diffInSeconds(Date::now());

        $interval = 3600;

        foreach (self::POLL_SCHEDULE as $threshold => $seconds) {
            if ($age <= $threshold) {
                $interval = $seconds;
                break;
            }
        }

        $this->next_poll_at = Date::now()->addSeconds($interval);
        $this->poll_attempts++;
        $this->save();
    }

    public function transitionTo(PaymentIntentStatus $status): void
    {
        $this->status->assertCanTransitionTo($status);

        $this->status = $status;
    }

    /**
     * Carevelo cannot refund. It holds nothing to refund from.
     *
     * This method exists solely to make that explicit to anyone who goes
     * looking for it. The clinic refunds through its own aggregator.
     */
    public function refund(): never
    {
        throw new IllegalTransition(
            'Carevelo cannot issue refunds: it never takes custody of patient funds. '
            .'The clinic refunds through its own aggregator dashboard, and the outcome '
            .'is recorded here. See docs/50-security-compliance/payments-regulatory-boundary.md'
        );
    }
}
