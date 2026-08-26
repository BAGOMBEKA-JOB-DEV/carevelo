<?php

namespace App\Models;

/**
 * Which side of the encounter typed a chat message.
 *
 * TWO CASES AND NO MORE, because ConsultationPolicy::participate admits
 * exactly two people to a consultation's chat: the patient the encounter
 * belongs to, and the clinician conducting it. This enum is the record of
 * which of the two spoke, and adding a third case here without widening that
 * ability would produce a value nothing can ever write.
 *
 * Stored alongside author_id rather than derived from it at read time. A
 * transcript opened years later -- from the offboarding export, or under a
 * break-glass grant -- has to be interpretable without resolving accounts that
 * may since have been deactivated, and "which of these lines are the doctor's"
 * is the first question any reader of a transcript asks.
 */
enum ConsultationMessageAuthor: string
{
    case Clinician = 'clinician';
    case Patient = 'patient';
}
