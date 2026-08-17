<?php

namespace App\Models\Concerns;

use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Narrows a query to the patient records an account owns, by patient_id.
 *
 * Satisfies App\Models\Contracts\RestrictableToPatient for the models that carry
 * patient_id directly. Delivery, PaymentIntent and OutboundNotification reach a
 * patient differently and implement the contract themselves.
 *
 * WHY THIS IS THE CONTROL. A policy answers one question about one row, so it
 * secures `show` and does nothing whatever for `index`. A listing that authorises
 * with viewAny() and then queries unscoped returns every patient in the clinic,
 * and row-level security cannot catch it because all of those rows genuinely do
 * belong to this tenant. The WHERE clause is the only thing between two patients
 * of the same clinic.
 *
 * An account owning no records narrows to nothing rather than to everything:
 * whereIn against an empty list compiles to a false predicate. That is the safe
 * direction, and it is why rows are returned only where ownership is positively
 * established.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 */
trait ScopedToPatientOwner
{
    /**
     * @param  Builder<covariant Model>  $query
     */
    public static function restrictToPatient(Builder $query, User $user): void
    {
        $query->whereIn('patient_id', $user->ownedPatientIds());
    }
}
