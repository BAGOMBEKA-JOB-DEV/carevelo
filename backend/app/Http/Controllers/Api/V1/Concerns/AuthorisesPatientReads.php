<?php

namespace App\Http\Controllers\Api\V1\Concerns;

use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Gate;

/**
 * Authorises a listing and narrows it in the same breath.
 *
 * The two are deliberately one call. A policy answers a question about one row,
 * so `viewAny` plus an unscoped query is the shape of the bug this exists to
 * prevent: the patient is correctly allowed to list something, and then receives
 * every other patient's rows as well. Row-level security cannot save it, because
 * every one of those rows really does belong to this tenant. The only control is
 * the WHERE clause, and a control that has to be remembered separately from the
 * authorisation next to it eventually is not.
 *
 * So there is no way to use this trait and get authorisation without scoping.
 * The branch that lets a patient through is the branch that narrows the query.
 *
 * Staff are not narrowed: the whole point of the clinic console is the whole
 * clinic. `viewAny` is the staff gate, `viewOwn` is the patient one, and a caller
 * satisfying neither is refused.
 *
 * @see docs/50-security-compliance/rbac-matrix.md
 */
trait AuthorisesPatientReads
{
    /**
     * @template TModel of \Illuminate\Database\Eloquent\Model&\App\Models\Contracts\RestrictableToPatient
     *
     * @param  Builder<TModel>  $query
     * @param  class-string<TModel>  $model
     * @return Builder<TModel>
     *
     * @throws AuthorizationException
     */
    protected function authoriseListing(Builder $query, ?User $user, string $model): Builder
    {
        // No session, no listing. Stated here rather than left to the Gate so the
        // narrowing below has a user it can rely on.
        if ($user === null) {
            throw new AuthorizationException;
        }

        $gate = Gate::forUser($user);

        if ($gate->allows('viewAny', $model)) {
            return $query;
        }

        if (! $gate->allows('viewOwn', $model)) {
            throw new AuthorizationException;
        }

        // Narrows in place, so the builder handed back is the one passed in and
        // keeps its precise type.
        $model::restrictToPatient($query, $user);

        return $query;
    }
}
