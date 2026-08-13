<?php

namespace App\Events;

use App\Broadcasting\TenantChannel;
use App\Models\DispenseOrder;
use Illuminate\Broadcasting\PrivateChannel;

/**
 * A named pharmacist of the clinic handed the order over.
 *
 * Goes to the pharmacy queue and to the patient's own channel. The patient's
 * identifier decides WHERE the frame goes; it is deliberately not part of WHAT
 * the frame says, because the queue leg of the same broadcast reaches every
 * pharmacist at once.
 */
final class OrderDispensed extends TenantBroadcast
{
    public function __construct(
        string $tenantId,
        public readonly string $orderId,
        public readonly string $reference,
        public readonly string $status,
        public readonly string $patientId,
    ) {
        parent::__construct($tenantId);
    }

    public static function from(DispenseOrder $order): self
    {
        return new self(
            self::tenantOf($order),
            self::keyOf($order),
            self::stringAttribute($order, 'reference'),
            $order->status->value,
            self::stringAttribute($order, 'patient_id'),
        );
    }

    /** @return list<PrivateChannel> */
    public function broadcastOn(): array
    {
        return [
            TenantChannel::pharmacyQueue($this->tenantId),
            TenantChannel::patient($this->tenantId, $this->patientId),
        ];
    }

    public function broadcastAs(): string
    {
        return 'order.dispensed';
    }

    /** @return array<string, string|null> */
    public function broadcastWith(): array
    {
        return [
            'order_id' => $this->orderId,
            'reference' => $this->reference,
            'status' => $this->status,
        ];
    }
}
