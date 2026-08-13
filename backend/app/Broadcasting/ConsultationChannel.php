<?php

namespace App\Broadcasting;

use App\Models\Consultation;
use App\Models\User;

/**
 * Consultation SESSION state — started, mode degraded, ended.
 *
 * NOT consultation media. Video and voice are a separate concern with a
 * separate provider decision, and Reverb never carries them.
 *
 * Delegates to ConsultationPolicy::view, the same policy the consultation
 * endpoint runs.
 */
class ConsultationChannel extends TenantPrefixedChannel
{
    public function pattern(): string
    {
        return TenantChannel::CONSULTATION;
    }

    protected function authorise(User $user, string ...$parameters): bool
    {
        $consultationId = $this->subjectId($parameters);

        if ($consultationId === null) {
            return false;
        }

        $consultation = Consultation::query()->find($consultationId);

        return $consultation !== null && $user->can('view', $consultation);
    }
}
