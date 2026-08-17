<?php

namespace App\Models\Contracts;

use App\Http\Controllers\Api\V1\Concerns\AuthorisesPatientReads;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * A model whose rows can be narrowed to the patient records an account owns.
 *
 * An interface with a real static method rather than an Eloquent local scope, for
 * two reasons.
 *
 * It is checkable. AuthorisesPatientReads narrows a query it only knows
 * generically, and a magic `->ownedByPatient()` cannot be verified against a
 * generic model — static analysis has to take it on trust, which for the one
 * control standing between two patients of the same clinic is the wrong bargain.
 * Declared here, a model that fails to implement it will not compile into the
 * listing helper at all.
 *
 * It is greppable. Every implementation is a stated answer to "how does this
 * table reach a patient", and the answers genuinely differ: appointments,
 * consultations, prescriptions and dispense orders carry patient_id; a delivery
 * reaches one through its order; a payment intent through whatever it is paying
 * for; a notification only through the number it was sent to.
 *
 * @see AuthorisesPatientReads
 */
interface RestrictableToPatient
{
    /**
     * Narrow the query to rows belonging to this account's patient records.
     *
     * Narrows IN PLACE and returns nothing. Eloquent's where methods mutate the
     * builder and hand back the same instance, so the caller keeps its own
     * precisely-typed builder rather than receiving a widened one -- Laravel types
     * Builder invariantly in its model parameter, and a Builder<static> declared
     * on an interface is not a Builder<Appointment>.
     *
     * An account owning no records must narrow to NOTHING, never to everything.
     *
     * @param  Builder<covariant Model>  $query
     */
    public static function restrictToPatient(Builder $query, User $user): void;
}
