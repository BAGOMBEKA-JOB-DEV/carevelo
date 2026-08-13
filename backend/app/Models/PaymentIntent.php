<?php

namespace App\Models;

use App\Exceptions\StateMachine\IllegalTransition;
use App\Models\Concerns\BelongsToTenant;
use App\Support\Money;
use Database\Factories\PaymentIntentFactory;
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
 * @property ?string $failure_message
 * @property ?Carbon $resolved_at
 * @property ?Carbon $initiated_at
 */
class PaymentIntent extends Model
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
