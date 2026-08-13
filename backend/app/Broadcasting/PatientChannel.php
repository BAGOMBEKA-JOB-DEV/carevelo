<?php

namespace App\Broadcasting;

use App\Models\Patient;
use App\Models\User;

/**
 * One patient's own appointment, payment, order and delivery state.
 *
 * The subscriber is resolved through the SAME policy as GET /v1/patients/{id}.
 * That keeps one answer to "may this person follow this patient" rather than
 * two that drift, and it means the patient portal gaining a User linked to a
 * Patient changes the policy, not this class.
 *
 * The lookup runs with row-level security bound to the session tenant, so a
 * patient identifier belonging to another clinic simply is not there — the
 * same 404-not-403 shape the API has, expressed as a refusal.
 */
class PatientChannel extends TenantPrefixedChannel
{
    public function pattern(): string
    {
        return TenantChannel::PATIENT;
    }

    protected function authorise(User $user, string ...$parameters): bool
    {
        $patientId = $this->subjectId($parameters);

        if ($patientId === null) {
            return false;
        }

        $patient = Patient::query()->find($patientId);

        return $patient !== null && $user->can('view', $patient);
    }
}
