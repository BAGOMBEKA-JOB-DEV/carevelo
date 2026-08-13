<?php

namespace App\Broadcasting;

use App\Models\Delivery;
use App\Models\User;

/**
 * The dispatch board: delivery created, assigned, status changed.
 *
 * Riders never join it. The board is every recipient and every address in the
 * clinic at once, and DeliveryPolicy::viewAny already says so for the REST
 * endpoint — this channel asks the same question rather than a parallel one
 * that could drift away from it.
 */
class DispatchBoardChannel extends TenantPrefixedChannel
{
    public function pattern(): string
    {
        return TenantChannel::DISPATCH_BOARD;
    }

    protected function authorise(User $user, string ...$parameters): bool
    {
        return $user->can('viewAny', Delivery::class);
    }
}
