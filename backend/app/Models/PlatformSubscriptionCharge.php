<?php

namespace App\Models;

use App\Exceptions\StateMachine\IllegalTransition;
use App\Support\Money;
use Database\Factories\PlatformSubscriptionChargeFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Date;

/**
 * One attempt to collect a clinic's subscription to the software.
 *
 * CAREVELO IS THE MERCHANT HERE, and that inverts every invariant the patient
 * payment path relies on. Read the two side by side before changing anything:
 *
 *   PaymentIntent                       PlatformSubscriptionCharge
 *   -------------                       --------------------------
 *   patient pays a clinic               a clinic pays Carevelo
 *   merchant is the clinic              merchant is Carevelo
 *   credentials from the clinic's row   credentials from config/env
 *   settles to the clinic               our own revenue
 *   tenant-scoped, RLS-isolated         platform-scoped, invisible in a tenant
 *   payable_type in {appointment,       no payable: the subject is the
 *     dispense_order}                     tenant's own subscription
 *
 * ADR-0003 permits this and only this: "Revenue is subscription-only (SS-F)".
 * Carevelo takes no custody of patient funds, and nothing on this model can
 * reach an aggregator_accounts row or a payment_intents row -- there is no
 * relation, no lookup and no shared service, and a test asserts it by watching
 * the queries a charge actually makes.
 *
 * NOT AN INVOICE, and the name says so on purpose. This records an attempt and
 * the aggregator's reported outcome, exactly as PaymentIntent does; it is not a
 * statement of what is owed, and there is no running total anywhere. There is
 * no concept in this system for money accruing against a clinic, and there must
 * not be one.
 *
 * @see docs/70-decisions/0003-non-custodial-payment-architecture.md
 * @see docs/20-domain/domain-model.md
 *
 * @property string $id
 * @property string $tenant_id
 * @property SubscriptionPlan $plan
 * @property Money $amount
 * @property Carbon $period_starts_on
 * @property Carbon $period_ends_on
 * @property SubscriptionChargeStatus $status
 * @property string $merchant_reference
 * @property ?string $aggregator_tracking_id
 * @property ?string $aggregator_reference
 * @property ?string $failure_code
 * @property Carbon $initiated_at
 * @property ?Carbon $resolved_at
 */
class PlatformSubscriptionCharge extends Model
{
    /** @use HasFactory<PlatformSubscriptionChargeFactory> */
    use HasFactory;

    use HasUlids;

    /**
     * Deliberately no BelongsToTenant.
     *
     * That trait scopes a model to the bound tenant and stamps tenant_id on
     * write, which is right for every clinical table and wrong here: this row
     * belongs to the PLATFORM and names a clinic, rather than belonging to a
     * clinic. Applying it would make the row readable inside that clinic's
     * session -- one clinic reading what Carevelo charges it, and one column
     * away from reading what Carevelo charges its competitors.
     *
     * The database enforces the rest. platform_subscription_charges carries an
     * inverted row-level-security policy: visible with no tenant bound,
     * invisible and unwritable with any tenant bound. So a query made from
     * inside a tenant returns nothing whatever this model does.
     */
    /**
     * Written by the billing service and by nothing else.
     *
     * No status, no aggregator_reference, no resolved_at: those are outcomes,
     * and an outcome that could arrive as an attribute is an outcome a caller
     * could assert without Pesapal having said it. They move through the
     * transition methods below, which is the only way they move.
     *
     * @var list<string>
     */
    protected $fillable = [
        'tenant_id',
        'plan',
        'amount',
        'currency',
        'period_starts_on',
        'period_ends_on',
        'merchant_reference',
        'aggregator_tracking_id',
        'initiated_at',
    ];

    /**
     * initiated_at and resolved_at are timestamptz.
     *
     * Laravel's default format is naive ('Y-m-d H:i:s'), so PostgreSQL resolves
     * the missing offset in the SESSION's timezone rather than the
     * application's, and the instant stored then depends on how the database
     * server happens to be configured. What shifts here is when a clinic was
     * charged, which is an accounting record.
     *
     * @var string
     */
    protected $dateFormat = 'Y-m-d H:i:sP';

    /**
     * Every charge starts unanswered-for.
     *
     * Set here rather than made fillable, because a caller able to create a row
     * already `succeeded` could record a collection Pesapal never made -- and
     * the first thing that would do with it is extend a clinic's paid-through
     * date.
     */
    protected static function booted(): void
    {
        static::creating(function (self $charge): void {
            if ($charge->getAttribute('status') === null) {
                $charge->status = SubscriptionChargeStatus::Initiated;
            }
        });
    }

    /** @return array<string, string> */
    protected function casts(): array
    {
        return [
            'plan' => SubscriptionPlan::class,
            'status' => SubscriptionChargeStatus::class,
            'amount' => Money::class,
            'period_starts_on' => 'date',
            'period_ends_on' => 'date',
            'initiated_at' => 'datetime',
            'resolved_at' => 'datetime',
        ];
    }

    /**
     * @return BelongsTo<Tenant, $this>
     */
    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /**
     * Record that Pesapal collected it.
     *
     * A state METHOD rather than an assignment, like every other transition in
     * this system: `$charge->status = 'succeeded'` is a string field with a
     * hopeful name, not a state machine. Illegal moves throw.
     *
     * The AMOUNT PESAPAL REPORTS is not stored over the amount we asked for. It
     * is compared by the caller and a mismatch resolves nothing -- the same
     * fraud boundary the patient path applies, for the same reason: a report
     * that money moved is a claim, not a fact, until it agrees with what was
     * asked for.
     */
    public function markSucceeded(?string $aggregatorReference): void
    {
        $this->status->assertCanTransitionTo(SubscriptionChargeStatus::Succeeded);

        $this->status = SubscriptionChargeStatus::Succeeded;
        $this->aggregator_reference = $aggregatorReference;
        $this->resolved_at = Date::now();
        $this->save();
    }

    /**
     * Record that it did not collect.
     *
     * The CODE only, never Pesapal's prose. A message column is where a consumer
     * key quoted back in an error would come to rest, and this row is read by
     * support tooling.
     */
    public function markFailed(?string $failureCode): void
    {
        $this->status->assertCanTransitionTo(SubscriptionChargeStatus::Failed);

        $this->status = SubscriptionChargeStatus::Failed;
        $this->failure_code = $failureCode;
        $this->resolved_at = Date::now();
        $this->save();
    }

    /** Rare, and always human-handled once recorded. */
    public function markReversed(?string $aggregatorReference): void
    {
        $this->status->assertCanTransitionTo(SubscriptionChargeStatus::Reversed);

        $this->status = SubscriptionChargeStatus::Reversed;
        $this->aggregator_reference = $aggregatorReference ?? $this->aggregator_reference;
        $this->resolved_at = Date::now();
        $this->save();
    }

    /**
     * Carevelo holds no clinic's money, so there is nothing here to refund.
     *
     * Stated as a method that throws for the same reason PaymentIntent::refund()
     * is: somebody will go looking for it, and finding nothing is ambiguous
     * while finding this is not. A subscription overcharge is corrected by
     * Carevelo through its own Pesapal dashboard, as a merchant, and recorded
     * here as `reversed` when Pesapal reports it.
     */
    public function refund(): never
    {
        throw new IllegalTransition(
            'Carevelo never takes custody of funds it can refund from. A subscription '
            .'correction is executed at Pesapal by Carevelo as the merchant, and appears '
            .'here as `reversed` when Pesapal reports it.'
        );
    }
}
