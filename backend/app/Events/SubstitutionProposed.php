<?php

namespace App\Events;

use App\Broadcasting\TenantChannel;
use App\Models\DispenseOrder;
use App\Models\Substitution;
use Illuminate\Broadcasting\PrivateChannel;

/**
 * A pharmacist proposed dispensing a different item, and a named clinician
 * must decide. There is no auto-approval, and the frame does not help anyone
 * decide — it tells the clinician to go and look.
 *
 * THE PROPOSED MEDICINE NAME IS NOT ON THE WIRE. It is the single most
 * tempting field to add here, because the clinician's decision needs it. They
 * fetch it from the API, where the policy runs.
 *
 * The clinician's USER id is supplied by the caller rather than resolved here:
 * an event that queries is an event whose payload depends on when it was
 * built.
 */
final class SubstitutionProposed extends TenantBroadcast
{
    public function __construct(
        string $tenantId,
        public readonly string $substitutionId,
        public readonly string $dispenseOrderId,
        public readonly string $orderReference,
        public readonly string $clinicianUserId,
    ) {
        parent::__construct($tenantId);
    }

    public static function from(Substitution $substitution, DispenseOrder $order, string $clinicianUserId): self
    {
        return new self(
            self::tenantOf($substitution),
            self::keyOf($substitution),
            self::keyOf($order),
            self::stringAttribute($order, 'reference'),
            $clinicianUserId,
        );
    }

    /** @return list<PrivateChannel> */
    public function broadcastOn(): array
    {
        return [TenantChannel::user($this->tenantId, $this->clinicianUserId)];
    }

    public function broadcastAs(): string
    {
        return 'substitution.proposed';
    }

    /** @return array<string, string|null> */
    public function broadcastWith(): array
    {
        return [
            'substitution_id' => $this->substitutionId,
            'dispense_order_id' => $this->dispenseOrderId,
            'order_reference' => $this->orderReference,
        ];
    }
}
