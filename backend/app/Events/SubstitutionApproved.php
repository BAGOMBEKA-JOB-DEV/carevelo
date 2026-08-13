<?php

namespace App\Events;

use App\Broadcasting\TenantChannel;
use App\Models\DispenseOrder;
use App\Models\Substitution;
use Illuminate\Broadcasting\PrivateChannel;

/**
 * A clinician decided on a proposed substitution, unblocking the item.
 *
 * The pharmacy is told the decision exists; the decision itself, and what was
 * substituted for what, come from the API. `status` carries the outcome, so
 * the same event serves an approval and a rejection without a second class
 * whose payload would be identical.
 */
final class SubstitutionApproved extends TenantBroadcast
{
    public function __construct(
        string $tenantId,
        public readonly string $substitutionId,
        public readonly string $dispenseOrderId,
        public readonly string $status,
    ) {
        parent::__construct($tenantId);
    }

    public static function from(Substitution $substitution, DispenseOrder $order): self
    {
        return new self(
            self::tenantOf($substitution),
            self::keyOf($substitution),
            self::keyOf($order),
            $substitution->status->value,
        );
    }

    /** @return list<PrivateChannel> */
    public function broadcastOn(): array
    {
        return [TenantChannel::pharmacyQueue($this->tenantId)];
    }

    public function broadcastAs(): string
    {
        return 'substitution.decided';
    }

    /** @return array<string, string|null> */
    public function broadcastWith(): array
    {
        return [
            'substitution_id' => $this->substitutionId,
            'dispense_order_id' => $this->dispenseOrderId,
            'status' => $this->status,
        ];
    }
}
