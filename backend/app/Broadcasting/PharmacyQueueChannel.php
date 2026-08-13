<?php

namespace App\Broadcasting;

use App\Models\DispenseOrder;
use App\Models\User;

/**
 * The pharmacy queue: order arrived, order state changed.
 *
 * A role channel, so it fans out to every pharmacist signed in at the clinic
 * at once — which is exactly why its frames carry identifiers and state only.
 */
class PharmacyQueueChannel extends TenantPrefixedChannel
{
    public function pattern(): string
    {
        return TenantChannel::PHARMACY_QUEUE;
    }

    /** The same policy the pharmacy queue endpoint runs. */
    protected function authorise(User $user, string ...$parameters): bool
    {
        return $user->can('viewAny', DispenseOrder::class);
    }
}
