<?php

namespace App\Broadcasting;

use App\Models\ClinicalRole;
use App\Models\User;

/**
 * One rider's own assignments, and nothing else in the system.
 *
 * A rider may join THEIR OWN channel only. Not another rider's, not the
 * dispatch board, not a patient channel — and a non-rider does not join a
 * rider channel either, so the least-trusted actor's surface stays exactly one
 * channel wide.
 *
 * The frames carry assignment identifiers. Everything a rider is entitled to
 * see arrives from the rider endpoint, which serves a resource class with no
 * clinical fields at all.
 */
class RiderChannel extends TenantPrefixedChannel
{
    public function pattern(): string
    {
        return TenantChannel::RIDER;
    }

    protected function authorise(User $user, string ...$parameters): bool
    {
        $riderId = $this->subjectId($parameters);

        return $riderId !== null
            && $user->id === $riderId
            && $user->hasRole(ClinicalRole::Rider->value);
    }
}
