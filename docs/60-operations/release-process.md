# Release Process

> **Status:** Draft
> **Last reviewed:** 2026-08-13
> **Derives from:** [Environments & Deployment](../30-architecture/environments-and-deployment.md)

How change reaches production. Written for a small team, so it is short — but the gates are not negotiable, because the failure modes they catch are silent and severe.

## Branching

Trunk-based. Short-lived branches off `main`, merged by pull request. Long-lived branches accumulate merge risk that a small team cannot afford to resolve.

Feature flags for anything incomplete, rather than a branch that lives for weeks.

## Pull requests

Every change, including the founder's own. Self-review of a diff catches a surprising amount, and the discipline matters more when there is nobody else to catch it.

Required before merge:

1. All CI gates green (below).
2. [Definition of Done](../80-quality/definition-of-done.md) satisfied.
3. **Security review** for anything touching authentication, tenancy, payments or clinical data. With one engineer this is a deliberate second pass on a separate day — imperfect, and better than nothing.

## CI gates — all blocking

| Gate | Catches |
|---|---|
| Pint, PHPStan level 8, ESLint, TypeScript | Style and type defects |
| Unit and integration tests | Regressions |
| **Cross-tenant isolation tests** | The failure we least tolerate |
| **Architecture tests** | Module boundary erosion; jobs missing tenant context |
| **Schema test** | A tenant-scoped table without RLS |
| **Forbidden-identifier check** | The identifiers in [Payments Regulatory Boundary](../50-security-compliance/payments-regulatory-boundary.md) |
| **Tree-boundary check** | PHP in `frontend/`, UI or asset pipeline in `backend/`, cross-tree imports |
| **API client in sync** | A contract change shipped without regenerating the client |
| **Channel-authorisation tests** | An unprefixed or unguarded Reverb channel |
| Dependency vulnerability scan | Known CVEs |
| Secret scan on the diff | Committed credentials |

CI is **path-filtered**: a `frontend/`-only change skips the PHP suite and vice versa. A change to `docs/40-api/openapi.yaml` runs both.

**An isolation test failure blocks release.** There is no severity conversation to have — see [Multi-Tenancy](../30-architecture/multi-tenancy.md).

## Migrations

Expand and contract, always. A health platform has no maintenance window a clinic will accept ([Environments & Deployment](../30-architecture/environments-and-deployment.md)).

**Migrations must be backward-compatible with the previous release**, because rollback is redeploying the previous image and a database cannot be rolled back with it.

Destructive migrations require a verified backup taken immediately before, and are never combined with a code release.

Every migration creating a tenant-scoped table enables RLS in the same file, via `Schema::enableTenantIsolation()`.

## Timing

**Avoid Ugandan clinic hours** — weekday mornings especially. A deploy during morning consultations is a self-inflicted incident, and the clinic will remember it.

Preferred: weekday evenings after 20:00 EAT, or Sunday.

Never deploy when you cannot watch it. A rollout nobody is watching is a rollout that fails at 03:00 and is discovered by a clinic at 08:00.

## Deploying

`backend/` and `frontend/` release independently ([ADR-0007](../70-decisions/0007-separate-backend-frontend-trees.md)).

1. Merge to `main`; CI runs the affected pipelines.
2. Deploy to staging; verify the critical paths — booking, payment, consultation, prescription.
3. Deploy to production, rolling with health checks. A failing check stops the rollout.
4. Watch error rate and latency for 30 minutes.
5. Record version, commit, migrations applied and deployer.

**When a release spans both trees, the backend goes first.** An additive contract change is harmless served to a frontend that does not yet read it; the reverse — a frontend calling a field that does not exist — is an outage. Removals reverse the order and wait a release, the same expand-and-contract discipline as migrations.

**Reverb restarts on a backend release**, dropping every open connection. Clients reconnect with backoff and re-authorise their channels, but it is felt — a pharmacist watching a queue sees it blank and refill. One more reason to deploy outside clinic hours.

## Rollback

Redeploy the previous image. It must work without a database restore — hence backward-compatible migrations.

**Roll back first, diagnose afterwards.** Debugging in production while clinics are affected is the wrong order, and the instinct to "just fix it forward" is usually optimism.

If a migration cannot be rolled back safely, that is a defect in the migration and it should not have shipped.

## Release notes

Per release, to clinics, in plain language — what is new, what is fixed, anything that changes their workflow.

Not a changelog of commits. **A clinic administrator should be able to read it in thirty seconds** and know whether anything affects them.

Workflow-changing releases get advance notice.

## Hotfixes

Same gates, compressed timeline. **The isolation, architecture and schema gates are never skipped** — they exist precisely for the moment when someone is in a hurry, which is when the mistakes happen.

Hotfix from the released tag, not from `main`, so unrelated work does not ship alongside.

## Post-release

- Watch for 30 minutes.
- Check the queue is draining ([Observability](../30-architecture/observability.md)).
- Confirm reconciliation is running.
- If a clinic reports a problem within an hour, assume the release caused it until proven otherwise.
