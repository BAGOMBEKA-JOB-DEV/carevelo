<?php

namespace App\Broadcasting;

use App\Models\User;

/**
 * One staff member's own notifications — a substitution awaiting their
 * approval, a payment resolving against something they raised.
 *
 * No policy delegation, because there is no REST endpoint for "another user's
 * notifications": the answer is identity, and identity is the whole rule.
 * A clinic administrator does not get to listen to a clinician's channel.
 */
class UserChannel extends TenantPrefixedChannel
{
    public function pattern(): string
    {
        return TenantChannel::USER;
    }

    protected function authorise(User $user, string ...$parameters): bool
    {
        $userId = $this->subjectId($parameters);

        return $userId !== null && $user->id === $userId;
    }
}
