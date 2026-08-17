<?php

namespace App\Http\Controllers\Api\V1;

use App\Audit\AuditLog;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Reads\IndexAuditEventRequest;
use App\Http\Resources\V1\AuditEventResource;
use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\User;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The evidence layer, read-only.
 *
 * There is one method on this controller and there is no route to a second. No
 * API can write an audit event -- events are written by the system as a side
 * effect of domain operations -- and nothing at all can update or delete one:
 * the application role holds INSERT and SELECT on the table and is denied
 * UPDATE and DELETE by grant, so an attacker with code execution cannot cover
 * their tracks whatever this class says.
 *
 * The trail is tenant-scoped by row-level security. A clinic sees its own and
 * only its own; platform-level events carry a null tenant and are invisible
 * from inside a tenant, in both directions.
 *
 * @see docs/50-security-compliance/audit-logging.md
 * @see docs/70-decisions/0006-audit-log-immutability.md
 */
class AuditEventController extends Controller
{
    public function index(IndexAuditEventRequest $request, AuditLog $audit): AnonymousResourceCollection
    {
        $this->authoriseAdministrator($request->user());

        $query = AuditEvent::query();

        $filters = $request->equalityFilters();

        foreach ($filters as $column => $value) {
            $query->where($column, $value);
        }

        $from = $request->from();

        if ($from !== null) {
            $query->where('occurred_at', '>=', $from);
        }

        $to = $request->to();

        if ($to !== null) {
            $query->where('occurred_at', '<=', $to);
        }

        // Cursor, not offset. The trail grows while it is being paged through --
        // including from this very read -- and offsets would duplicate and skip
        // rows in a record whose value is that it is complete.
        $events = $query
            ->orderByDesc('occurred_at')
            ->orderByDesc('id')
            ->cursorPaginate($request->perPage());

        // READING THE AUDIT LOG IS ITSELF AUDITED. Otherwise the log has a
        // blind spot exactly where an insider would look: someone checking
        // whether their own access had been noticed would leave no trace of
        // having checked.
        //
        // Recorded after the query, so this event is not in the page it
        // describes -- an event that reported itself would be a puzzle for
        // whoever read it next.
        $audit->record('audit_log.read', metadata: [
            'filters' => $filters,
            'returned' => $events->count(),
        ]);

        return AuditEventResource::collection($events);
    }

    /**
     * Only the clinic administrator, and only an active one.
     *
     * Checked here rather than through a policy because AuditEvent has no
     * policy to hang it on: the model has no create, update or delete ability
     * to describe, and inventing a policy whose every method returns false but
     * one would suggest the others are merely switched off rather than absent.
     *
     * Other tenant roles read nothing. A clinician does not audit the clinic,
     * and the trail names which patients each colleague looked at.
     *
     * @see docs/50-security-compliance/rbac-matrix.md -- Administration
     *
     * @throws AuthorizationException
     */
    private function authoriseAdministrator(mixed $user): void
    {
        if ($user instanceof User && $user->is_active && $user->hasRole(ClinicalRole::ClinicAdmin->value)) {
            return;
        }

        throw new AuthorizationException('Only a clinic administrator may read the audit trail.');
    }
}
