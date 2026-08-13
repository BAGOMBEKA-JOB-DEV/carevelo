<?php

namespace App\Console\Commands;

use App\Jobs\ReconcilePaymentIntentJob;
use App\Models\PaymentIntent;
use App\Models\PaymentIntentStatus;
use App\Models\Tenant;
use App\Models\TenantStatus;
use App\Tenancy\Tenancy;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Date;

/**
 * The reconciliation backstop, swept once a minute.
 *
 * It runs every minute but does NOT poll every unresolved intent every minute:
 * it selects the intents whose next poll is DUE under the graduated schedule
 * that PaymentIntent holds -- frequent while a mobile-money confirmation is
 * plausibly imminent, sparse thereafter. The schedule lives in one place, in
 * docs/40-api/webhooks.md and PaymentIntent::POLL_SCHEDULE, and is deliberately
 * not restated here.
 *
 * Register in routes/console.php:
 *     Schedule::command('payments:reconcile')->everyMinute();
 *
 * @see docs/30-architecture/backend-laravel.md
 * @see docs/40-api/webhooks.md
 */
class ReconcilePaymentsCommand extends Command
{
    /** @var string */
    protected $signature = 'payments:reconcile {--tenant= : Sweep a single tenant id}';

    /** @var string */
    protected $description = 'Dispatch a status poll for every payment intent whose reconciliation check is due';

    public function handle(Tenancy $tenancy): int
    {
        $dispatched = 0;

        // Per tenant, via Tenancy::run -- never one cross-tenant query. A
        // sweep that selected across tenants would be a query no row-level
        // security policy could scope, and the first one written would work
        // fine right up until it did not.
        //
        // forEach collects failures rather than aborting: one clinic's bad data
        // must not stop every other clinic's payments resolving.
        $failures = $tenancy->forEach($this->tenantIds(), function () use (&$dispatched): void {
            PaymentIntent::query()
                ->whereNotNull('next_poll_at')
                ->where('next_poll_at', '<=', Date::now())
                ->whereIn('status', [
                    PaymentIntentStatus::Initiated,
                    PaymentIntentStatus::Pending,
                    // timed_out is swept too. It is NOT final: a late
                    // mobile-money confirmation still moves it to succeeded.
                    PaymentIntentStatus::TimedOut,
                ])
                ->each(function (PaymentIntent $intent) use (&$dispatched): void {
                    ReconcilePaymentIntentJob::dispatch($intent->id);
                    $dispatched++;
                });
        });

        foreach ($failures as $tenantId => $failure) {
            $this->components->error(sprintf('Tenant %s: %s', $tenantId, $failure->getMessage()));
        }

        $this->components->info(sprintf('Dispatched %d reconciliation poll(s).', $dispatched));

        return $failures === [] ? self::SUCCESS : self::FAILURE;
    }

    /**
     * @return list<string>
     */
    private function tenantIds(): array
    {
        $only = $this->option('tenant');

        if (is_string($only) && $only !== '') {
            return [$only];
        }

        // Suspended clinics still have payments in flight; a commercial
        // suspension must not strand a patient's collection unresolved.
        /** @var list<string> $ids */
        $ids = Tenant::query()
            ->where('status', '!=', TenantStatus::Closed)
            ->pluck('id')
            ->all();

        return $ids;
    }
}
