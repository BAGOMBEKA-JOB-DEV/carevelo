<?php

namespace App\Console\Commands;

use App\Audit\AuditLog;
use App\Models\Tenant;
use App\Models\TenantStatus;
use App\Services\Billing\PlatformMerchant;
use App\Tenancy\Tenancy;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Date;

/**
 * Suspends a clinic whose subscription has lapsed.
 *
 * READ WHAT SUSPENSION IS BEFORE CHANGING ANYTHING HERE. It is a COMMERCIAL
 * action and must never become a clinical one. It blocks STAFF SIGN-IN -- that
 * is the point of it -- and it does NOT stop a patient reading their own
 * records, does NOT stop a delivery already in flight, and does NOT permit
 * withholding the offboarding export. Those rules live in Accounts::
 * mayStartSession(), which blocks by ROLE rather than by tenant, and in
 * TenantPolicy::export(), which is deliberately not conditioned on status. This
 * command changes a status and nothing else, which is exactly why those rules
 * continue to hold; a test asserts all three after the sweep has run.
 *
 * THREE THINGS THIS COMMAND WILL NOT DO, each learned from the way a billing
 * sweep goes wrong.
 *
 * 1. IT WILL NOT SUSPEND A CLINIC WITH NO COMMERCIAL RECORD. Every clinic in
 *    the register had a null current_period_ends_at the day this shipped,
 *    because the column did not exist the day before. Reading "no paid period"
 *    as "lapsed" would have suspended every clinic in the country on the first
 *    run, from a scheduled job, at whatever hour the deployment landed. The
 *    rule lives in Tenant::subscriptionHasLapsed() and is stated there at
 *    length.
 *
 * 2. IT WILL NOT SUSPEND AT THE STROKE OF MIDNIGHT. Mobile-money collections
 *    here fail for reasons unconnected to willingness to pay -- a network
 *    outage, an agent shortage, a SIM swap -- and Pesapal's recurring retry may
 *    land a day late. config/billing.php holds the grace period and argues for
 *    it.
 *
 * 3. IT WILL NOT REACH A CLINIC'S DATA. It runs with NO TENANT BOUND, reads the
 *    platform-scoped register, and writes a status. There is no Tenancy::run()
 *    in it, because there is nothing inside a clinic it needs.
 *
 * Register in routes/console.php:
 *     Schedule::command('billing:suspend-lapsed')->hourly();
 *
 * @see docs/20-domain/state-machines.md tenant lifecycle
 * @see docs/50-security-compliance/rbac-matrix.md
 */
class SuspendLapsedSubscriptionsCommand extends Command
{
    /**
     * ONE LINE, and it has to stay one line.
     *
     * ScheduledWorkTest derives a command's name by splitting the signature on
     * the first SPACE, so a signature wrapped across lines yields a name with a
     * newline in it, which matches nothing on the schedule -- and the test then
     * reports a scheduled command as unscheduled.
     *
     * @var string
     */
    protected $signature = 'billing:suspend-lapsed {--dry-run : Report what would be suspended and change nothing}';

    /** @var string */
    protected $description = 'Suspend clinics whose subscription period has lapsed beyond the grace window';

    public function handle(PlatformMerchant $merchant, AuditLog $audit, Tenancy $tenancy): int
    {
        // A bound tenant would make every query below read one clinic's view of
        // a platform-scoped table, which for `tenants` means the whole register
        // and for the charges table means nothing at all. Refusing is cheaper
        // than reasoning about which.
        if ($tenancy->has()) {
            $this->components->error(
                'billing:suspend-lapsed must run with no tenant bound. It reads the '
                .'platform register, not a clinic.'
            );

            return self::FAILURE;
        }

        $now = Date::now();
        $graceDays = $merchant->graceDays();
        $dryRun = (bool) $this->option('dry-run');

        $suspended = 0;

        // Only `active` clinics. TenantStatus permits active -> suspended and
        // nothing else into that state, so a provisioning clinic that has never
        // been billed, one already suspended, and one part-way through
        // offboarding are all correctly untouched -- and none of them needs a
        // special case here, because the state machine already said so.
        Tenant::query()
            ->where('status', TenantStatus::Active)
            ->orderBy('id')
            ->each(function (Tenant $tenant) use ($now, $graceDays, $dryRun, $audit, &$suspended): void {
                if (! $tenant->subscriptionHasLapsed($now, $graceDays)) {
                    return;
                }

                $suspended++;

                if ($dryRun) {
                    $this->components->twoColumnDetail($tenant->slug, '<fg=yellow>would suspend</>');

                    return;
                }

                $previous = $tenant->status;
                $previous->assertCanTransitionTo(TenantStatus::Suspended);

                $tenant->status = TenantStatus::Suspended;
                $tenant->save();

                // The same action name a platform operator's manual suspension
                // writes, with `system` as the actor because no operator is
                // present. One action for one kind of event: a support agent
                // reading the trail should not have to know which of two words
                // to search for.
                $audit->record(
                    'tenant.status_changed',
                    subjectType: 'Tenant',
                    subjectId: $tenant->id,
                    metadata: [
                        'from' => $previous->value,
                        'to' => TenantStatus::Suspended->value,
                        'reason' => 'subscription_lapsed',
                        'grace_days' => $graceDays,
                    ],
                );

                $this->components->twoColumnDetail($tenant->slug, '<fg=red>suspended</>');
            });

        $this->components->info(sprintf(
            '%s %d clinic(s) with a lapsed subscription (grace %d day(s)).',
            $dryRun ? 'Would suspend' : 'Suspended',
            $suspended,
            $graceDays,
        ));

        return self::SUCCESS;
    }
}
