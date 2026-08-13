<?php

namespace App\Policies;

use App\Models\AggregatorAccount;
use App\Models\ClinicalRole;
use App\Models\User;

class AggregatorAccountPolicy
{
    use HandlesTenantAuthorisation;

    /** Status and provider only. The secrets themselves are never readable. */
    public function view(User $user, AggregatorAccount $account): bool
    {
        return $this->sameTenant($user, $account->tenant_id)
            && $this->hasAnyRole($user, [ClinicalRole::ClinicAdmin]);
    }

    public function update(User $user, AggregatorAccount $account): bool
    {
        return $this->sameTenant($user, $account->tenant_id)
            && $this->hasAnyRole($user, [ClinicalRole::ClinicAdmin]);
    }

    /**
     * NOBODY reads the credentials back.
     *
     * Not the administrator who entered them, and not Carevelo. They are
     * write-only, envelope-encrypted, and decrypted only in memory at the
     * moment of an outbound call. Phishing the UI yields nothing to read.
     */
    public function viewSecrets(User $user, AggregatorAccount $account): bool
    {
        return false;
    }
}
