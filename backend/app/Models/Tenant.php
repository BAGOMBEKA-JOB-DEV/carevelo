<?php

namespace App\Models;

use App\Support\Money;
use Carbon\CarbonInterface;
use Database\Factories\TenantFactory;
use Illuminate\Database\Eloquent\Concerns\HasUlids;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Carbon;

/**
 * A clinic.
 *
 * The unit of isolation, branding, subscription and support.
 *
 * Platform-scoped: this is the tenant register itself, so it carries no
 * tenant_id and is not subject to row-level security. It is one of the few
 * tables in that category — see the allow-list in the schema conformance test.
 *
 * @see docs/20-domain/domain-model.md
 *
 * @property string $id
 * @property string $slug
 * @property string $subdomain
 * @property string $legal_name
 * @property TenantStatus $status
 * @property ?Carbon $trial_ends_at
 * @property ?SubscriptionPlan $plan
 * @property ?Money $plan_price
 * @property ?Carbon $current_period_ends_at
 */
class Tenant extends Model
{
    /** @use HasFactory<TenantFactory> */
    use HasFactory;

    use HasUlids;

    protected $fillable = [
        'slug',
        'legal_name',
        'trading_name',
        'subdomain',
        'custom_domain',
        'primary_colour',
        'secondary_colour',
        'logo_path',
        'contact_phone',
        'contact_email',
        'physical_address',
        'district',
        'umdpc_facility_reference',
        'nda_licence_reference',
        'status',
        'timezone',
        'currency',
        'trial_ends_at',
    ];

    /*
     * `plan`, `plan_price` and `current_period_ends_at` are deliberately ABSENT
     * from $fillable.
     *
     * None of the three is a client's to supply. A paid-through date that could
     * arrive as a request attribute is a paid-through date a clinic could set
     * for itself, and a plan price that could is a discount anybody can grant.
     * They are written by PlatformSubscriptions and by the notification path,
     * through explicit assignment, so every write to them is visible in a diff.
     *
     * The same argument BreakGlassGrant makes about tenant_notified_at: a field
     * that records what somebody ELSE did must not be settable by the party it
     * is about.
     */

    /**
     * Subdomains that must never be claimed by a clinic.
     *
     * @var list<string>
     */
    public const RESERVED_SLUGS = [
        'www', 'api', 'app', 'admin', 'docs', 'status', 'mail', 'help',
        'support', 'billing', 'static', 'assets', 'cdn', 'reverb',
    ];

    /**
     * Timestamps are written WITH their offset.
     *
     * current_period_ends_at is timestamptz and Laravel's default format is
     * naive ('Y-m-d H:i:s'), so PostgreSQL would resolve the missing offset
     * using the SESSION's TimeZone rather than the application's. The value that
     * would shift is the one deciding whether a clinic's staff can sign in
     * tomorrow morning -- three hours in whichever direction the deployment
     * happens to be configured.
     *
     * Columns declared without a timezone ignore the offset, so created_at,
     * updated_at and trial_ends_at are unaffected by this.
     *
     * @var string
     */
    protected $dateFormat = 'Y-m-d H:i:sP';

    /**
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'status' => TenantStatus::class,
            'trial_ends_at' => 'datetime',
            'plan' => SubscriptionPlan::class,
            // Pairs plan_price_minor with the `currency` column already here, so
            // the amount stays a native integer the database can sum and compare
            // and the currency is never implied.
            'plan_price' => Money::class,
            'current_period_ends_at' => 'datetime',
        ];
    }

    public function isActive(): bool
    {
        return $this->status === TenantStatus::Active;
    }

    /**
     * Whether this clinic's subscription has run out, allowing for grace.
     *
     * THE MOST IMPORTANT LINE IN THIS METHOD IS THE ONE THAT RETURNS FALSE FOR A
     * CLINIC WITH NO DATES AT ALL. Every clinic on the platform the day this
     * shipped had a null current_period_ends_at, because the column did not
     * exist the day before. A sweep that read "no paid period" as "lapsed" would
     * have suspended every clinic in the register on its first run -- blocking
     * every front desk in the country simultaneously, from a scheduled job, at
     * whatever hour the deployment happened to land.
     *
     * So absence of a commercial record is NOT evidence of non-payment. A clinic
     * nobody has billed is a clinic nobody has billed, and the answer is a
     * conversation, not a suspension.
     *
     * The trial is read when there is no paid period, so a trial that expires
     * without conversion lapses in the ordinary way rather than granting
     * indefinite free service.
     *
     * Grace is not a credit line and nothing accrues during it. It exists
     * because mobile-money collections in this market fail for reasons that have
     * nothing to do with willingness to pay, and closing a clinic's front desk
     * over a telecom fault would be a clinical harm caused by a billing rule.
     */
    public function subscriptionHasLapsed(CarbonInterface $asOf, int $graceDays): bool
    {
        $paidThrough = $this->current_period_ends_at ?? $this->trial_ends_at;

        if ($paidThrough === null) {
            return false;
        }

        return $paidThrough->copy()->addDays($graceDays)->isBefore($asOf);
    }
}
