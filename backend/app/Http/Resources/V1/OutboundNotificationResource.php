<?php

namespace App\Http\Resources\V1;

use App\Models\OutboundNotification;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One message the clinic sent, or tried to.
 *
 * The row exists to answer "was the patient told?" after a missed appointment,
 * an uncollected order or a complaint. `body` is returned because what was
 * actually sent is the fact in dispute -- and it is safe to return because it
 * was rendered from a template catalogue that carries no clinical content.
 *
 * THE RECIPIENT IS MASKED. Staff reach this history from a patient's record,
 * where they already have the number; returning it in full on a list endpoint
 * would make the send history a way to enumerate the clinic's patients by phone
 * number, which is a disclosure that someone is a patient here.
 *
 * @see docs/10-product/notifications-sms-whatsapp.md
 *
 * @mixin OutboundNotification
 */
class OutboundNotificationResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $createdAt = $this->getAttribute('created_at');

        return [
            'id' => $this->id,
            'channel' => $this->channel->value,
            'template_key' => $this->template_key,
            'recipient' => $this->maskedRecipient(),
            'body' => $this->body,
            // `sent` means the gateway accepted it; only `delivered` means a
            // handset received it, and only where the gateway reports receipts.
            'status' => $this->status->value,
            'sent_at' => $this->sent_at?->toIso8601String(),
            'delivered_at' => $this->delivered_at?->toIso8601String(),
            'failure_reason' => $this->failure_reason,
            'created_at' => $createdAt instanceof CarbonInterface ? $createdAt->toIso8601String() : null,
        ];
    }
}
