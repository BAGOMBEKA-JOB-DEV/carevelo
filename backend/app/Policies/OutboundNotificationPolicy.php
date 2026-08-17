<?php

namespace App\Policies;

use App\Models\ClinicalRole;
use App\Models\OutboundNotification;
use App\Models\User;

/**
 * Who may read the notification log.
 *
 * The clinic's own view of it answers "was the patient told?", which is a
 * question that arrives after a missed appointment or a complaint, and it is the
 * administrator's to ask -- the log is a list of messages sent to every patient
 * of the clinic.
 *
 * A patient sees only messages addressed to their own number. Their side of the
 * same question is "was I told?", and refusing it means a patient who never
 * received an SMS has no way to establish that.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 * @see docs/10-product/notifications-sms-whatsapp.md
 */
class OutboundNotificationPolicy
{
    use HandlesTenantAuthorisation;

    /** The clinic-wide log. */
    public function viewAny(User $user): bool
    {
        return $this->hasAnyRole($user, [ClinicalRole::ClinicAdmin]);
    }

    /**
     * The patient's own messages.
     *
     * Grants entry to a LISTING only, and only alongside the scoping in
     * AuthorisesPatientReads. Which rows are theirs is settled by
     * OutboundNotification::scopeOwnedByPatient(), which matches on the recipient
     * number because that is the only link a notification has to a person.
     */
    public function viewOwn(User $user): bool
    {
        return $this->hasAnyRole($user, [ClinicalRole::Patient]);
    }

    /**
     * Nobody edits or deletes a sent notification.
     *
     * It is evidence of what the clinic told the patient and when. A log that can
     * be corrected after a complaint is not a log.
     */
    public function update(User $user, OutboundNotification $notification): bool
    {
        return false;
    }

    public function delete(User $user, OutboundNotification $notification): bool
    {
        return false;
    }
}
