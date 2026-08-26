<?php

namespace App\Policies;

use App\Models\ClinicalRole;
use App\Models\Clinician;
use App\Models\Consultation;
use App\Models\User;

class ConsultationPolicy
{
    use HandlesTenantAuthorisation;

    /**
     * The clinic's own encounters, as a list.
     *
     * A clinic_admin who is not a clinician may read consultations --
     * administrators of small clinics genuinely need this -- but every such
     * read is audited. Nobody else on the staff side appears: front desk books
     * appointments and never opens the encounter behind one, and a pharmacist
     * reaches what they need through the dispense order.
     */
    public function viewAny(User $user): bool
    {
        return $this->hasAnyRole($user, [ClinicalRole::ClinicAdmin, ClinicalRole::Clinician]);
    }

    /**
     * The patient's own consultations.
     *
     * Grants entry to a LISTING only, and only alongside the scoping in
     * AuthorisesPatientReads -- holding this and querying unscoped would hand one
     * patient the whole clinic's records. Which rows are theirs is settled by
     * isPatientOf(), not by this.
     */
    public function viewOwn(User $user): bool
    {
        return $this->hasAnyRole($user, [ClinicalRole::Patient]);
    }

    public function view(User $user, Consultation $consultation): bool
    {
        if (! $this->sameTenant($user, $consultation->tenant_id)) {
            return false;
        }

        // Expressed through viewAny() rather than repeating its role list, so
        // the single-record answer and the listing answer cannot drift apart.
        //
        // The patient may read the record of their own consultation. Their own
        // care is not confidential FROM them, and the clinical notes on it are
        // exactly what a second opinion needs.
        return $this->viewAny($user) || $this->isPatientOf($user, $consultation->patient_id);
    }

    /** Only a clinician conducts a consultation. */
    public function create(User $user): bool
    {
        return $this->hasAnyRole($user, [ClinicalRole::Clinician]);
    }

    public function conduct(User $user, Consultation $consultation): bool
    {
        return $this->sameTenant($user, $consultation->tenant_id)
            && $this->hasAnyRole($user, [ClinicalRole::Clinician]);
    }

    /**
     * The two people actually inside this encounter: the patient it belongs to,
     * and the clinician conducting it. Nobody else, including other clinicians
     * of the same clinic and including the administrator.
     *
     * WHY THIS ABILITY HAD TO EXIST RATHER THAN REUSING conduct().
     *
     * ClinicalNote borrows this policy and writes behind conduct(), which is
     * Clinician-only on purpose -- "an administrator who may read the encounter
     * may not author within it". Chat cannot borrow it, because THE PATIENT
     * MUST BE ABLE TO TYPE. Copying the note's authorisation would have shipped
     * a chat window a patient can read and not answer, and the fallback the
     * threat model promises for a video outage would have been half a channel.
     *
     * WHY IT IS NARROWER THAN view() ON THE READ SIDE TOO, WHICH IS A REAL
     * DEVIATION FROM THE NOTE. ClinicalNoteController::index authorises with
     * view(), so any clinician or administrator of the clinic may read a note.
     * Chat reads are narrower for two reasons. First, the RBAC matrix already
     * says so for this encounter's realtime channel -- `tenant.{id}.
     * consultation.{id}` is "own" for the clinician and "own" for the patient,
     * and a dash for the administrator -- and the chat transcript is that
     * channel's content. Second, a note is authored FOR the record by someone
     * who knows the next clinician will read it, while a patient types into a
     * chat window things they would not write on a form; making the transcript
     * readable on sight by the whole clinic changes what they are willing to
     * say, which degrades the channel clinically.
     *
     * What this costs, stated rather than glossed: a covering clinician seeing
     * this patient next week cannot read the transcript through the API. It
     * remains part of the record -- it is in the offboarding export and
     * reachable under an audited break-glass grant -- but there is no
     * clinician-facing route to another clinician's chat, and if the clinic
     * needs one it should be added deliberately and audited, not by widening
     * this to view().
     */
    public function participate(User $user, Consultation $consultation): bool
    {
        if (! $this->sameTenant($user, $consultation->tenant_id)) {
            return false;
        }

        // The patient side. isPatientOf() is the same check view() already uses
        // to let a patient read their own encounter, so the two answers cannot
        // drift: anyone who may read this consultation as its patient may speak
        // in it, and nobody else reaches the patient branch at all.
        if ($this->isPatientOf($user, $consultation->patient_id)) {
            return true;
        }

        return $this->conductsThisEncounter($user, $consultation);
    }

    /**
     * Whether this account is the clinician holding THIS consultation.
     *
     * conduct() asks a different and looser question -- "is this a clinician of
     * this clinic" -- which is right for a note, where the clinic's clinicians
     * are collectively the authors of a shared record. It is wrong for a
     * conversation: a clinician down the corridor is not in this call, and
     * typing into it would put an unexpected third voice into an encounter the
     * patient believes is private.
     *
     * Consultation.clinician_id names a Clinician record, not a user, because a
     * clinical encounter is held by a practitioner registered with the UMDPC,
     * AHPC or the Nurses & Midwives Council and engaged by this clinic -- the
     * role alone is not enough. So the account is resolved through that record.
     * The role check still runs first: a practitioner whose staff account has
     * been deactivated, or whose clinician role was removed, stops being able to
     * speak in encounters that still name them.
     */
    private function conductsThisEncounter(User $user, Consultation $consultation): bool
    {
        if (! $this->hasAnyRole($user, [ClinicalRole::Clinician])) {
            return false;
        }

        $clinicianId = $consultation->clinician_id;

        if ($clinicianId === null) {
            return false;
        }

        // Row-level security scopes this to the bound tenant, and sameTenant()
        // has already established that the user belongs to it.
        return Clinician::query()
            ->whereKey($clinicianId)
            ->where('user_id', $user->id)
            ->exists();
    }
}
