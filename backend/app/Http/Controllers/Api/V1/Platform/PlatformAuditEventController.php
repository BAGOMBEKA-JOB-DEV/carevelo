<?php

namespace App\Http\Controllers\Api\V1\Platform;

use App\Audit\AuditLog;
use App\Http\Controllers\Controller;
use App\Http\Requests\V1\Platform\IndexPlatformAuditEventRequest;
use App\Http\Resources\V1\PlatformAuditEventResource;
use App\Models\AuditEvent;
use App\Models\ClinicalRole;
use App\Models\User;
use App\Tenancy\Tenancy;
use Illuminate\Auth\Access\AuthorizationException;
use Illuminate\Contracts\Pagination\CursorPaginator;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The platform audit register: the read that closes a write-only trail.
 *
 * ============================================================
 * WHAT WAS WRONG BEFORE THIS EXISTED
 * ============================================================
 *
 * Carevelo writes break-glass grants, tenant provisioning and suspension, TOTP enrolments
 * and platform sign-ins into audit_events with a NULL tenant_id -- that is what makes them
 * platform events. The only published read of that table was `GET /v1/audit-events`: a
 * tenant route, clinic-administrator-only, scoped by row-level security to one clinic. The
 * isolation policy on this table is disjoint in both directions, so a row with no tenant is
 * invisible from inside every tenant there is.
 *
 * The arithmetic of those two facts is that the entire platform-side audit trail was
 * WRITE-ONLY from the product's point of view. Every control that ends "and it is audited"
 * -- the break-glass review that is supposed to notice a rising count, the record of who
 * enrolled a second factor, the sign-in trail on the highest-privilege sessions in the
 * product -- was writing evidence nobody could read back. An unreadable audit trail is not
 * a control, it is a belief.
 *
 * ============================================================
 * ONE RESPONSE IS ONE TRAIL, AND THAT IS RLS BEING OBEYED
 * ============================================================
 *
 * Without `tenant_id` this reads the platform trail. With one it enters that clinic's
 * context through Tenancy::run() -- the same door BreakGlassAccess goes through, and the
 * only door there is -- and reads that clinic's trail under the policy.
 *
 * There is deliberately no mixed page. Producing one would require a second RLS policy
 * letting an unset tenant context see tenant rows, which is the exact thing
 * enableTenantIsolationWithPlatformRows() says in its own comment that it does not do
 * ("Platform and tenant data stay disjoint in both directions, so this is not a hole in the
 * isolation model"). A permanent hole in the database's isolation model, so that a console
 * screen could offer every clinic at once by default, is a bad trade twice over: it weakens
 * the control AND it makes reading every clinic's trail the thing that happens when an
 * operator opens a page and does nothing.
 *
 * ============================================================
 * WHAT AN OPERATOR SEES OF A CLINIC'S TRAIL
 * ============================================================
 *
 * The envelope and never the payload -- see PlatformAuditEventResource, which is where that
 * boundary is enforced and argued field by field. Metadata dropped whole, `subject_id`,
 * `ip_address` and `user_agent` withheld. That is what docs/50-security-compliance/
 * rbac-matrix.md means by "metadata" in the platform columns of the audit-log row, and it
 * is why this endpoint is not simply the tenant endpoint with the scope taken off.
 *
 * The projection is chosen by the ROW rather than by the caller: there is no parameter that
 * widens it, so an operator cannot ask for more and a future caller cannot forget to ask
 * for less.
 *
 * ============================================================
 * NO WRITE, NO SECOND METHOD, NO ROUTE TO ONE
 * ============================================================
 *
 * Like its tenant counterpart. No API writes an audit event -- events are written by the
 * system as a side effect of domain operations -- and nothing updates or deletes one: the
 * application role holds INSERT and SELECT on the table and is denied UPDATE and DELETE by
 * grant, so an attacker with code execution cannot cover their tracks whatever this class
 * says.
 *
 * @see docs/50-security-compliance/audit-logging.md
 * @see docs/70-decisions/0006-audit-log-immutability.md
 */
class PlatformAuditEventController extends Controller
{
    public function index(
        IndexPlatformAuditEventRequest $request,
        AuditLog $audit,
        Tenancy $tenancy,
    ): AnonymousResourceCollection {
        $this->authoriseOperator($request->user());

        $tenantId = $request->tenantId();

        $events = $tenantId === null
            ? $this->page($request)
            : $tenancy->run($tenantId, fn (): CursorPaginator => $this->page($request));

        /*
         * READING THE AUDIT LOG IS ITSELF AUDITED, and on this surface that is the whole
         * point rather than a formality. The blind spot the rule exists to close is "an
         * insider checking whether their own access had been noticed", and the insider with
         * the widest reach in this product is a Carevelo operator with a verified platform
         * session.
         *
         * WRITTEN INTO THE PLATFORM TRAIL, INCLUDING WHEN A CLINIC'S TRAIL WAS READ. Nothing
         * happens inside Tenancy::run() above except the SELECT, so this record is made with
         * no tenant bound and lands where the rest of this operator's actions land -- one
         * trail, in time order, which is what somebody reviewing an operator's week needs.
         *
         * It is deliberately NOT also surfaced to the clinic, which is a departure from
         * break-glass and rests on what the two disclose. A break-glass access hands us a
         * patient's record, so the controller is told; this read hands us the fact that
         * something happened and withholds the payload, the record identifier and the
         * staff member's address. The day this endpoint returns more than the envelope is
         * the day that reasoning stops holding, and the notification belongs with it.
         *
         * Recorded AFTER the query, so the event is not in the page it describes -- an
         * event that reported itself would be a puzzle for whoever read it next.
         */
        $audit->record('audit_log.read', metadata: [
            'surface' => 'platform',
            'trail' => $tenantId === null ? 'platform' : 'tenant',
            // WHICH clinic's trail was read. The one identifier that makes this event
            // answerable months later, and it names a clinic rather than a person.
            'tenant_id' => $tenantId,
            'filters' => $request->equalityFilters(),
            'returned' => $events->count(),
        ]);

        return PlatformAuditEventResource::collection($events);
    }

    /**
     * One page of whichever trail the caller is standing in.
     *
     * Called either bare -- no tenant bound, so the policy shows platform rows -- or inside
     * Tenancy::run(). The query is the same either way ON PURPOSE: there is no `where
     * tenant_id` anywhere in this class, because a scope written in PHP is a scope that can
     * be forgotten, and the one in the database cannot be.
     *
     * @return CursorPaginator<AuditEvent>
     */
    private function page(IndexPlatformAuditEventRequest $request): CursorPaginator
    {
        $query = AuditEvent::query();

        foreach ($request->equalityFilters() as $column => $value) {
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

        /*
         * CURSOR, NEVER OFFSET. The trail grows while it is being paged through -- from
         * this very read, which writes an event of its own -- and an offset would duplicate
         * and skip rows in a record whose entire value is that it is complete. A skipped row
         * on a security review is the one that was not looked at.
         *
         * Ordered by id as well as time because occurred_at is not unique: several events
         * are written in one transaction by a single domain operation, and a cursor over a
         * non-unique key cannot say where it stopped.
         */
        return $query
            ->orderByDesc('occurred_at')
            ->orderByDesc('id')
            ->cursorPaginate($request->perPage());
    }

    /**
     * Both standing platform roles, and nothing else.
     *
     * docs/50-security-compliance/rbac-matrix.md § Administration gives "Audit log — read"
     * as `metadata` in the `platform_support` and `platform_admin` columns alike. Support
     * meets the incident first, and a register that made them escalate to read metadata
     * would produce either a delay or a shared login.
     *
     * `break_glass` IS A PLATFORM ROLE AND IS DELIBERATELY NOT ON THIS LIST. It is granted
     * temporarily by a grant, it confers clinical read access inside the affected tenant's
     * own surfaces, and it confers nothing here. Accepting it would let an active grant
     * quietly widen what its holder can read about every OTHER clinic, which is the exact
     * opposite of a scoped, time-boxed grant.
     *
     * Checked here rather than through a policy for the reason AuditEventController gives:
     * AuditEvent has no create, update or delete ability to describe, and a policy whose
     * every method returned false but one would suggest the others are switched off rather
     * than absent.
     *
     * The account must also be a PLATFORM account -- `tenant_id is null` -- and not merely
     * hold the role name. A tenant account carrying a platform role would be an account
     * with a tenant bound by its own session; there is no such thing today and this is not
     * the endpoint on which to find out.
     *
     * @throws AuthorizationException
     */
    private function authoriseOperator(mixed $user): void
    {
        $permitted = [ClinicalRole::PlatformAdmin->value, ClinicalRole::PlatformSupport->value];

        if ($user instanceof User && $user->is_active && $user->isPlatformUser() && $user->hasAnyRole($permitted)) {
            return;
        }

        throw new AuthorizationException('Only a Carevelo platform operator may read the platform audit register.');
    }
}
