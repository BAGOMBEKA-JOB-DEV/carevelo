<?php

namespace App\Support\Notifications;

use App\Jobs\SendNotificationJob;
use App\Models\OutboundNotification;
use App\Models\Tenant;
use App\Support\PhoneNumber;
use App\Tenancy\TenantContext;
use Illuminate\Cache\RateLimiter;
use Illuminate\Support\Facades\Log;

/**
 * The only way to send a message out of Carevelo.
 *
 * Callers name an event and pass identifiers. They do not compose text, they do
 * not choose the channel, and they cannot name the sender -- the clinic name is
 * overwritten here from the tenant record, so a caller cannot accidentally (or
 * deliberately) send under someone else's brand.
 *
 * NOTHING IS SENT INSIDE THE CALLER'S TRANSACTION. This method writes one row
 * and queues a job after commit; the gateway is reached from the worker. An SMS
 * timeout must never fail a booking, and a booking that rolled back must never
 * produce a message telling the patient it succeeded.
 *
 * @see docs/10-product/notifications-sms-whatsapp.md
 */
class Notifier
{
    /**
     * Messages per tenant per minute.
     *
     * Contains cost and, more importantly, the blast radius of a bug: a loop
     * that sends one SMS per prescription item is a bad afternoon, and a loop
     * that sends one per row in a table is an incident with a bill attached.
     */
    public const MAX_PER_TENANT_PER_MINUTE = 120;

    public function __construct(
        protected TemplateRegistry $templates,
        protected TenantContext $context,
        protected RateLimiter $limiter,
    ) {}

    /**
     * Queue one notification.
     *
     * @param  array<string, string|int>  $parameters  placeholder values; `clinic` is supplied here and any caller value is ignored
     * @param  bool  $alsoOnWhatsApp  the patient opted in AND the template is approved for it
     *
     * @throws \InvalidArgumentException on an unknown template, a missing placeholder or an unusable number
     * @throws ProhibitedNotificationContent when a parameter carries clinical content
     */
    public function send(
        string $templateKey,
        string $recipient,
        array $parameters = [],
        bool $alsoOnWhatsApp = false,
    ): OutboundNotification {
        $template = $this->templates->get($templateKey);

        // Normalised here rather than trusted from the caller: the same string
        // reaches the gateway, and "0772 123 456" and "+256772123456" must not
        // become two different rows in the send history. An unparseable number
        // throws -- it is a data defect at the point it was stored, and sending
        // health-adjacent messages to a mistyped number is the failure this
        // prevents.
        $e164 = PhoneNumber::parse($recipient)->e164;

        $parameters['clinic'] = $this->clinicName();

        $body = $template->render($parameters);

        if ($this->isRateLimited()) {
            return $this->suppress($template, $e164, $body);
        }

        $notification = $this->queue($template, NotificationChannel::Sms, $e164, $body);

        // SMS always went first, so WhatsApp is additive by construction and
        // cannot become the sole channel through a caller's mistake.
        if ($alsoOnWhatsApp && $template->supports(NotificationChannel::WhatsApp)) {
            $this->queue($template, NotificationChannel::WhatsApp, $e164, $body);
        }

        return $notification;
    }

    private function queue(
        NotificationTemplate $template,
        NotificationChannel $channel,
        string $recipient,
        string $body,
    ): OutboundNotification {
        $notification = OutboundNotification::create([
            'channel' => $channel,
            'recipient' => $recipient,
            'template_key' => $template->key,
            'body' => $body,
            'status' => NotificationStatus::Queued,
        ]);

        // afterCommit, always. If the transaction that booked the appointment
        // rolls back, the row queued above disappears with it -- and a job
        // already on the queue would find nothing and log a phantom failure.
        SendNotificationJob::dispatch($notification->id)
            ->onQueue($template->queue)
            ->afterCommit();

        return $notification;
    }

    /**
     * Over the tenant's minute allowance: record the attempt, send nothing.
     *
     * Recorded rather than dropped so the clinic can see what was suppressed;
     * a silently discarded notification is indistinguishable from one the
     * patient ignored.
     */
    private function suppress(
        NotificationTemplate $template,
        string $recipient,
        string $body,
    ): OutboundNotification {
        $notification = OutboundNotification::create([
            'channel' => NotificationChannel::Sms,
            'recipient' => $recipient,
            'template_key' => $template->key,
            'body' => $body,
            'status' => NotificationStatus::Failed,
            'failure_reason' => 'rate_limited',
        ]);

        Log::warning('notification.rate_limited', [
            'tenant_id' => $this->context->currentOrFail(),
            'template_key' => $template->key,
            'notification_id' => $notification->id,
        ]);

        return $notification;
    }

    /**
     * Whether the tenant has spent its minute allowance -- counting this message
     * against it if not.
     *
     * Every template in the catalogue is subject to the cap, with no exemptions.
     * There was one, for the sign-in code, and its reasoning was specific to that
     * message: a person had asked for it and was waiting for it, one per attempt,
     * so suppressing one locked a patient out of their own records -- and abuse of
     * that path was already bounded per number and per address by AuthThrottle,
     * at the endpoint rather than here. Nothing left in the catalogue has that
     * shape. Every remaining message is raised by the clinic's own workflow, so
     * the tenant-wide cap is both the right place to bound it and the only one.
     *
     * If a message somebody is actively waiting on is ever added, exempt it on a
     * property the template declares rather than by naming its key here: a rule
     * that lives in this method is one nobody can find from the template it
     * applies to.
     */
    private function isRateLimited(): bool
    {
        $key = self::rateLimitKey($this->context->currentOrFail());

        if ($this->limiter->tooManyAttempts($key, self::MAX_PER_TENANT_PER_MINUTE)) {
            return true;
        }

        $this->limiter->hit($key, 60);

        return false;
    }

    /** Tenant-namespaced, like every other key in this system. */
    public static function rateLimitKey(string $tenantId): string
    {
        return 'tenant:'.$tenantId.':notifications';
    }

    /**
     * The name the patient will recognise.
     *
     * The trading name, falling back to the legal name: a clinic registered as
     * "Kira Health Services Limited" is known locally as "Kira Clinic", and a
     * message from a name nobody recognises is a message nobody trusts.
     */
    private function clinicName(): string
    {
        $tenant = Tenant::query()->findOrFail($this->context->currentOrFail());
        $trading = $tenant->getAttribute('trading_name');

        return is_string($trading) && $trading !== '' ? $trading : $tenant->legal_name;
    }
}
