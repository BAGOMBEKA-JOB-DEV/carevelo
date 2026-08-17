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
 * Closes a consultation whose call dropped and was never resumed.
 *
 * A clinician who ends a consultation reports an outcome, and a technical failure
 * moves the appointment to `abandoned`. But a call that drops hard — the
 * clinician's power goes, the browser is closed, the handset dies — is never ended
 * by anybody, and the appointment sat `in_progress` for ever.
 *
 * That is not merely untidy. `in_progress` is a live state: it is what the clinic
 * console shows as happening now, it blocks the terminal transition the clinic's
 * own reporting counts, and a consultation that never completes is a consultation
 * nobody reconciles against the payment.
 *
 * The patient gets a resume link first — the window here is deliberately generous,
 * so a clinician reconnecting after a power cut rejoins the same consultation
 * rather than finding it closed underneath them.
 *
 * Register in routes/console.php:
 *     Schedule::command('consultations:abandon-stale')->everyFifteenMinutes();
 *
 * @see docs/20-domain/state-machines.md — "only after the window closes does the
 *      appointment abandon"
 */
class AbandonStaleConsultationsCommand extends Command
{
    /** @var string */
    protected $signature = 'consultations:abandon-stale {--tenant= : Sweep a single tenant id}';

    /** @var string */
    protected $description = 'Abandon any consultation left in progress past its resume window';

    public function handle(Tenancy $tenancy, AuditLog $audit): int
    {
        $abandoned = 0;

        // Per tenant, via Tenancy::run -- never one cross-tenant query, for the
        // same reason as the other sweeps: a cross-tenant select is a query no row
        // policy can scope.
        $failures = $tenancy->forEach($this->tenantIds(), function () use (&$abandoned, $audit): void {
            $cutoff = Date::now()->subMinutes(Appointment::RESUME_WINDOW_MINUTES);

            Appointment::query()
                ->where('status', AppointmentStatus::InProgress)
                ->whereNotNull('scheduled_end_at')
                ->where('scheduled_end_at', '<=', $cutoff)
                ->each(function (Appointment $appointment) use (&$abandoned, $audit): void {
                    // Guarded, exactly as ConsultationController::closeAppointment
                    // is: another actor may have closed it between the select and
                    // here, and this sweep must not fail because of it.
                    if (! $appointment->status->canTransitionTo(AppointmentStatus::Abandoned)) {
                        return;
                    }

                    $appointment->transitionTo(AppointmentStatus::Abandoned);

                    // Recorded as a system action. A consultation the clinic
                    // believes happened, closed by a sweep rather than by a
                    // clinician, is exactly the kind of thing a clinic will later
                    // ask about.
                    $audit->record('appointment.abandoned', 'Appointment', $appointment->id, [
                        'reason' => 'resume_window_elapsed',
                        'window_minutes' => Appointment::RESUME_WINDOW_MINUTES,
                    ]);

                    $abandoned++;
                });
        });

        foreach ($failures as $tenantId => $failure) {
            $this->components->error(sprintf('Tenant %s: %s', $tenantId, $failure->getMessage()));
        }

        $this->components->info(sprintf('Abandoned %d stale consultation(s).', $abandoned));

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

        /** @var list<string> $ids */
        $ids = Tenant::query()
            ->where('status', '!=', TenantStatus::Closed)
            ->pluck('id')
            ->all();

        return $ids;
    }
}
