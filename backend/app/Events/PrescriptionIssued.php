<?php

namespace App\Events;

use App\Broadcasting\TenantChannel;
use App\Models\DispenseOrder;
use App\Models\Prescription;
use Illuminate\Broadcasting\PrivateChannel;

/**
 * A clinician issued a prescription; work has arrived in the pharmacy queue.
 *
 * The pharmacist learns that an order exists and then FETCHES it, under
 * policy, to learn what is on it. The medicines are never on the wire: the
 * queue channel fans out to every pharmacist signed in, and a frame is a
 * disclosure surface exactly as an SMS is.
 */
final class PrescriptionIssued extends TenantBroadcast
{
    public function __construct(
        string $tenantId,
        public readonly string $prescriptionId,
        public readonly ?string $dispenseOrderId = null,
        public readonly ?string $reference = null,
    ) {
        parent::__construct($tenantId);
    }

    /**
     * The dispense order is optional because a prescription may be issued for
     * collection elsewhere — the clinic's pharmacy is a choice, never a
     * requirement, and Carevelo holds no medicines of its own.
     */
    public static function from(Prescription $prescription, ?DispenseOrder $order = null): self
    {
        return new self(
            self::tenantOf($prescription),
            self::keyOf($prescription),
            $order === null ? null : self::keyOf($order),
            $order === null ? null : self::stringAttribute($order, 'reference'),
        );
    }

    /** @return list<PrivateChannel> */
    public function broadcastOn(): array
    {
        return [TenantChannel::pharmacyQueue($this->tenantId)];
    }

    public function broadcastAs(): string
    {
        return 'prescription.issued';
    }

    /** @return array<string, string|null> */
    public function broadcastWith(): array
    {
        return [
            'prescription_id' => $this->prescriptionId,
            'dispense_order_id' => $this->dispenseOrderId,
            'reference' => $this->reference,
        ];
    }
}
