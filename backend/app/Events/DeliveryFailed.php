<?php

namespace App\Events;

use App\Broadcasting\TenantChannel;
use App\Models\Delivery;
use App\Models\DispenseOrder;
use Illuminate\Broadcasting\PrivateChannel;

/**
 * A delivery did not reach the recipient.
 *
 * A failure is never a resting state — the medicine returns to the licensed
 * premises and the patient is offered another attempt — so this frame exists
 * to put the delivery back in front of a dispatcher quickly.
 *
 * `failure_reason` is one of Delivery::FAILURE_REASONS, an operational code
 * from a fixed list. Anything else is dropped rather than forwarded: free text
 * is where clinical content escapes, and a frame is not the place to find out.
 */
final class DeliveryFailed extends TenantBroadcast
{
    public function __construct(
        string $tenantId,
        public readonly string $deliveryId,
        public readonly string $status,
        public readonly string $patientId,
        public readonly ?string $failureReason = null,
    ) {
        parent::__construct($tenantId);
    }

    public static function from(Delivery $delivery, DispenseOrder $order): self
    {
        $reason = $delivery->failure_reason;

        return new self(
            self::tenantOf($delivery),
            self::keyOf($delivery),
            $delivery->status->value,
            self::stringAttribute($order, 'patient_id'),
            in_array($reason, Delivery::FAILURE_REASONS, true) ? $reason : null,
        );
    }

    /** @return list<PrivateChannel> */
    public function broadcastOn(): array
    {
        return [
            TenantChannel::dispatchBoard($this->tenantId),
            TenantChannel::patient($this->tenantId, $this->patientId),
        ];
    }

    public function broadcastAs(): string
    {
        return 'delivery.failed';
    }

    /** @return array<string, string|null> */
    public function broadcastWith(): array
    {
        return [
            'delivery_id' => $this->deliveryId,
            'status' => $this->status,
            'failure_reason' => $this->failureReason,
        ];
    }
}
