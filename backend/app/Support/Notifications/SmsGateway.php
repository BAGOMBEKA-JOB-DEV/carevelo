<?php

namespace App\Support\Notifications;

use App\Models\OutboundNotification;
use Illuminate\Support\Facades\Log;

/**
 * The seam where a message leaves Carevelo.
 *
 * ONE CONCRETE CLASS, not an interface with a single implementation. No SMS
 * aggregator is contracted yet -- per-message rates and sender-ID registration
 * are still to be confirmed live with the gateway (§F) -- and an abstraction
 * written for a provider nobody has integrated is a guess about that provider's
 * shape. When the second one arrives, extract the interface then, from two real
 * implementations.
 *
 * Until then this records the intent and delivers nothing, which is honest: the
 * notification sits at `sent` because the gateway accepted it, and there is no
 * gateway to report otherwise.
 *
 * @see docs/10-product/notifications-sms-whatsapp.md
 */
class SmsGateway
{
    /**
     * Hand one message to the operator.
     *
     * @throws GatewayUnavailable when the provider cannot be reached
     */
    public function send(OutboundNotification $notification): void
    {
        // Identifiers only. The body is absent deliberately: a log is read by
        // more people, for longer, than the message ever should be -- and while
        // the body carries nothing clinical by construction, the log is not the
        // place to find out that a template was wrong. The recipient is masked
        // for the same reason a phone number is scrubbed from an audit event.
        Log::info('notification.handed_to_gateway', [
            'notification_id' => $notification->id,
            'template_key' => $notification->template_key,
            'channel' => $notification->channel->value,
            'recipient' => $notification->maskedRecipient(),
        ]);
    }
}
