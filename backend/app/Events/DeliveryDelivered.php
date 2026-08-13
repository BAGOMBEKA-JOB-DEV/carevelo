<?php

namespace App\Events;

use App\Broadcasting\TenantChannel;
use App\Models\Delivery;
use App\Models\DispenseOrder;
use Illuminate\Broadcasting\PrivateChannel;

/**
 * A delivery reached the recipient.
 *
 * Dispatch board and the patient's own channel. The patient identifier comes
 * from the dispense order rather than from a query, so the event stays a value
 * object: constructing one touches no database and therefore needs no tenant
 * context of its own.
 */
final class DeliveryDelivered extends TenantBroadcast
{
    public function __construct(
        string $tenantId,
        public readonly string $deliveryId,
        public readonly string $status,
        public readonly string $patientId,
    ) {
        parent::__construct($tenantId);
    }

    public static function from(Delivery $delivery, DispenseOrder $order): self
    {
        return new self(
            self::tenantOf($delivery),
            self::keyOf($delivery),
            $delivery->status->value,
            self::stringAttribute($order, 'patient_id'),
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
        return 'delivery.delivered';
    }

    /** @return array<string, string|null> */
    public function broadcastWith(): array
    {
        return [
            'delivery_id' => $this->deliveryId,
            'status' => $this->status,
        ];
    }
}
