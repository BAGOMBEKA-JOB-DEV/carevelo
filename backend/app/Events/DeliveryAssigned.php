<?php

namespace App\Events;

use App\Broadcasting\TenantChannel;
use App\Models\Delivery;
use Illuminate\Broadcasting\PrivateChannel;

/**
 * A dispatcher gave a delivery to a named rider.
 *
 * Two channels: the dispatch board, and that rider's own channel. The rider
 * leg carries a delivery identifier and a reference — the recipient, the
 * phone and the address reach them through the rider endpoint, which serves a
 * resource class with no clinical fields, and only while consent stands.
 */
final class DeliveryAssigned extends TenantBroadcast
{
    public function __construct(
        string $tenantId,
        public readonly string $deliveryId,
        public readonly string $reference,
        public readonly string $status,
        public readonly string $riderId,
    ) {
        parent::__construct($tenantId);
    }

    /** Refuses a delivery with no rider: an assignment to nobody is not one. */
    public static function from(Delivery $delivery): self
    {
        return new self(
            self::tenantOf($delivery),
            self::keyOf($delivery),
            self::stringAttribute($delivery, 'reference'),
            $delivery->status->value,
            self::stringAttribute($delivery, 'rider_id'),
        );
    }

    /** @return list<PrivateChannel> */
    public function broadcastOn(): array
    {
        return [
            TenantChannel::dispatchBoard($this->tenantId),
            TenantChannel::rider($this->tenantId, $this->riderId),
        ];
    }

    public function broadcastAs(): string
    {
        return 'delivery.assigned';
    }

    /** @return array<string, string|null> */
    public function broadcastWith(): array
    {
        return [
            'delivery_id' => $this->deliveryId,
            'reference' => $this->reference,
            'status' => $this->status,
        ];
    }
}
