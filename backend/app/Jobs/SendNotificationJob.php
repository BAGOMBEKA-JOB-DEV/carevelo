<?php

namespace App\Jobs;

use App\Audit\AuditLog;
use App\Models\OutboundNotification;
use App\Support\Notifications\GatewayUnavailable;
use App\Support\Notifications\SmsGateway;
use App\Support\Notifications\TemplateRegistry;
use App\Tenancy\Tenancy;
use Illuminate\Support\Facades\Log;
use Throwable;

/**
 * Hands one already-composed message to the gateway.
 *
 * This job composes nothing. The body was rendered from the template catalogue
 * inside the originating request and stored on the row, so what is sent is
 * exactly what was reviewed -- and a template edited between queueing and
 * sending cannot rewrite a message already promised to a patient.
 *
 * WHY IT IS A JOB AT ALL: an SMS gateway timeout must never fail a booking.
 * The originating transaction commits, then this runs. If the gateway is down,
 * three attempts on a widening backoff; if it is still down, the notification
 * is marked failed and, where it is critical, surfaced to clinic staff rather
 * than swallowed.
 *
 * @see docs/10-product/notifications-sms-whatsapp.md delivery guarantees
 */
class SendNotificationJob extends TenantAwareJob
{
    /** Three attempts, per the delivery guarantees in the notifications doc. */
    public int $tries = 3;

    public function __construct(public readonly string $notificationId)
    {
        parent::__construct();
    }

    /**
     * Exponential backoff, in seconds.
     *
     * Wide enough to outlast a brief operator wobble, short enough that an OTP
     * still arrives while the patient is looking at the sign-in screen.
     *
     * @return list<int>
     */
    public function backoff(): array
    {
        return [10, 60, 300];
    }

    protected function handleForTenant(): void
    {
        $notification = OutboundNotification::query()->find($this->notificationId);

        if ($notification === null) {
            // The originating transaction rolled back, or retention removed the
            // row. Either way there is nothing to send and nothing to report.
            return;
        }

        if ($notification->status->isResolved()) {
            // Already sent, or already abandoned. A duplicate SMS costs money
            // and, on a shared handset, doubles the disclosure surface.
            return;
        }

        app(SmsGateway::class)->send($notification);

        $notification->markSent();

        // Identifiers and outcome only. Which template, to which record --
        // never the body, never the number. That someone was told is auditable;
        // what they were told lives behind authentication.
        app(AuditLog::class)->record('notification.sent', 'OutboundNotification', $notification->id, [
            'template_key' => $notification->template_key,
            'channel' => $notification->channel->value,
        ]);
    }

    /**
     * The retries are exhausted.
     *
     * Runs with NO tenant context -- the worker calls this outside handle(),
     * and the request that knew the tenant is long gone -- so it re-enters the
     * tenant explicitly. Without this the update below would match zero rows
     * under RLS and the failure would itself fail, silently.
     */
    public function failed(?Throwable $exception): void
    {
        app(Tenancy::class)->run($this->tenantId, function () use ($exception): void {
            $notification = OutboundNotification::query()->find($this->notificationId);

            if ($notification === null || $notification->status->isResolved()) {
                return;
            }

            $notification->markFailed(
                $exception instanceof GatewayUnavailable ? 'gateway_unavailable' : 'rejected_by_gateway'
            );

            $isCritical = app(TemplateRegistry::class)->get($notification->template_key)->isCritical;

            app(AuditLog::class)->record(
                'notification.failed',
                'OutboundNotification',
                $notification->id,
                [
                    'template_key' => $notification->template_key,
                    'channel' => $notification->channel->value,
                    'failure_reason' => $notification->failure_reason,
                    'critical' => $isCritical,
                ]
            );

            // A patient who was never told the pharmacy is waiting for them
            // needs a human to notice. Logged at warning for the critical set
            // so it reaches the clinic's operational surface rather than
            // disappearing into the failed-jobs table.
            Log::log($isCritical ? 'warning' : 'info', 'notification.send_failed', [
                'notification_id' => $notification->id,
                'template_key' => $notification->template_key,
                'recipient' => $notification->maskedRecipient(),
                'critical' => $isCritical,
            ]);
        });
    }
}
