<?php

namespace App\Console\Commands;

use App\Audit\AuditLog;
use App\Models\Appointment;
use App\Models\AppointmentStatus;
use App\Models\Tenant;
use App\Models\TenantStatus;
use App\Tenancy\Tenancy;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Date;

/**
 * Gives back the slot an abandoned mobile-money prompt is still holding.
 *
 * Booking creates the appointment in `awaiting_payment` and holds the slot while
 * the prompt sits on the patient's handset — availability excludes it deliberately,
 * because offering it twice would send a second patient into a rejection at the
 * last step. Most prompts are never completed: the patient loses signal, has no
 * float, or simply walks away.
 *
 * Until this command existed nothing released those slots. `awaiting_payment -->
 * expired` was specified in the state machine and implemented nowhere, so every
 * abandoned prompt removed a slot from the clinic's calendar permanently. On a
 * thirty-minute grid that is one whole consultation, lost silently, per
 * abandonment — and the clinic would experience it as "the system says we are
 * full".
 *
 * IT DOES NOT TOUCH THE PAYMENT. `timed_out` is explicitly not final and late
 * mobile-money confirmations are ordinary, so the intent is left to resolve on its
 * own schedule. A payment that succeeds after the slot was released is real money
 * in the clinic's own account, and the clinic refunds it through its own
 * aggregator — Carevelo holds no funds and does not decide refund policy. The
 * anomaly is flagged for them rather than silently un-expiring the appointment.
 *
 * Register in routes/console.php:
 *     Schedule::command('appointments:release-unpaid')->everyMinute();
 *
 * @see docs/20-domain/state-machines.md
 * @see docs/10-product/prd-h3-teleconsultation.md
 */
class ReleaseUnpaidAppointmentsCommand extends Command
{
    /** @var string */
    protected $signature = 'appointments:release-unpaid {--tenant= : Sweep a single tenant id}';

    /** @var string */
    protected $description = 'Release the slot held by any booking left unpaid past the hold window';

    public function handle(Tenancy $tenancy, AuditLog $audit): int
    {
        $released = 0;

        // Per tenant, via Tenancy::run -- never one cross-tenant query. A sweep
        // that selected across tenants would be a query no row-level security
        // policy could scope, and the first one written would work fine right up
        // until it did not.
        //
        // forEach collects failures rather than aborting: one clinic's bad data
        // must not stop every other clinic's slots being released.
        $failures = $tenancy->forEach($this->tenantIds(), function () use (&$released, $audit): void {
            $cutoff = Date::now()->subMinutes(Appointment::UNPAID_HOLD_MINUTES);

            Appointment::query()
                ->where('status', AppointmentStatus::AwaitingPayment)
                ->where('created_at', '<=', $cutoff)
                ->each(function (Appointment $appointment) use (&$released, $audit): void {
                    // The state machine decides legality, not this command. If
                    // another actor moved the appointment between the select and
                    // here, it refuses and the sweep moves on.
                    if (! $appointment->status->canTransitionTo(AppointmentStatus::Expired)) {
                        return;
                    }

                    $appointment->transitionTo(AppointmentStatus::Expired);

                    // Expiry is the system taking something away from a patient
                    // who was mid-payment, so it is recorded. `expired` and
                    // `cancelled` are deliberately different states and the clinic
                    // reads them differently.
                    $audit->record('appointment.slot_released', 'Appointment', $appointment->id, [
                        'reason' => 'unpaid_hold_elapsed',
                        'held_minutes' => Appointment::UNPAID_HOLD_MINUTES,
                    ]);

                    $released++;
                });
        });

        foreach ($failures as $tenantId => $failure) {
            $this->components->error(sprintf('Tenant %s: %s', $tenantId, $failure->getMessage()));
        }

        $this->components->info(sprintf('Released %d unpaid slot(s).', $released));

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

        // Suspended clinics are swept too, matching the reconciliation sweep. A
        // commercial suspension must not leave the calendar of a clinic that
        // later resumes clogged with slots nobody paid for.
        /** @var list<string> $ids */
        $ids = Tenant::query()
            ->where('status', '!=', TenantStatus::Closed)
            ->pluck('id')
            ->all();

        return $ids;
    }
}
