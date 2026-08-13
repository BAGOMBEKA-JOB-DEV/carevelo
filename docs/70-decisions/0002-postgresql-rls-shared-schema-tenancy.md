# ADR-0002 — Shared-schema tenancy enforced by PostgreSQL RLS

> **Status:** Accepted
> **Date:** 2026-08-13
> **Derives from:** Business Plan §H7, §I, §J.5

## Context

Each clinic is a **data controller** of special-category health data under DPPA 2019. §H7.1 requires that one clinic can never read another's data.

Two facts sharpen this beyond ordinary multi-tenancy. First, our tenants are frequently **each other's local competitors** — a leak is a commercial disclosure as well as a regulatory breach. Second, a cross-tenant leak is a **notifiable breach affecting two controllers simultaneously**, which is a materially worse incident than a single-tenant breach ([Incident Response](../50-security-compliance/incident-response.md)).

Against that, operational reality: a solo founder operating the platform, with hundreds of tenants expected by Phase 3 (§K). Migrations must be tractable.

## Options considered

### A. Database per tenant

Strongest isolation. A query cannot cross a database boundary.

**Against:** a migration must run across every database. At 300 tenants with no operations engineer, a schema change becomes an all-day operation with partial-failure states. Connection pooling across hundreds of databases is wasteful. Provisioning is slow, which conflicts with the under-one-day onboarding target (§K).

### B. Schema per tenant

Good isolation, one database. `stancl/tenancy` supports it well.

**Against:** the same migration problem, less severely. Hundreds of schemas make cross-cutting operations — retention sweeps, platform reporting — awkward. PostgreSQL performance degrades with very large schema counts.

### C. Shared schema, application-layer scoping only

One schema, `tenant_id` on every row, Eloquent global scopes.

**Against, decisively:** every one of the following bypasses a global scope, and every one appears in ordinary code written by competent people.

```php
DB::table('patients')->get();          // query builder ignores Eloquent scopes
DB::select('select * from patients');  // raw SQL
Model::withoutGlobalScopes()->get();   // occasionally legitimate
Patient::find($idFromRequest);         // no scope on a primary-key lookup
```

The last is the killer. It looks entirely normal, it appears in every controller, and it returns another tenant's record if the ID is guessed or leaked. **Reviewing every future query forever is not a control.**

### D. Shared schema with PostgreSQL row-level security — chosen

One schema, `tenant_id` on every row, and policies enforced **by the database**. The application connects as a non-owner role with `NOBYPASSRLS`; tenant context is set per transaction with `SET LOCAL app.tenant_id`.

Crucially, it **fails closed**: `current_setting('app.tenant_id', true)` returns NULL when unset, the comparison yields NULL, and **no rows match**. Missing context returns zero rows, never all rows.

Every bypass in option C is defeated, because the database does not care which PHP construct produced the query.

**Against:** RLS must be correctly configured, and the failure mode is silent — if the application role owns the tables, PostgreSQL exempts it and every policy becomes inert while the system appears to work perfectly. This is a real risk and it is why the configuration is asserted at boot and in CI rather than merely documented.

## Decision

**Shared database, shared schema, `tenant_id` on every row, enforced by PostgreSQL row-level security.**

- Application role `carevelo_app`: **not** the table owner, `NOBYPASSRLS`, no DDL.
- Migration role `carevelo_migrator`: owns the tables, bypasses RLS.
- Every tenant-scoped table: RLS enabled **and forced**, with `USING` and `WITH CHECK` policies.
- Composite foreign keys on `(tenant_id, id)`, making a cross-tenant reference structurally impossible.
- Eloquent global scopes retained as a **convenience layer**; RLS is the control.

Full implementation in [Multi-Tenancy](../30-architecture/multi-tenancy.md).

## Consequences

**Accepted costs.**

- Every tenant-scoped migration must enable RLS in the same file. Mitigated by a `Schema::enableTenantIsolation()` macro so it cannot be half-applied.
- **Any connection pooler must run in transaction mode.** `SET LOCAL` is transaction-scoped; a session-mode pooler could carry tenant context between requests belonging to different tenants — a cross-tenant read with no code defect at all. Asserted by configuration test ([Environments](../30-architecture/environments-and-deployment.md)).
- Queued jobs must restore tenant context explicitly, since the request context is gone. Enforced by `TenantAwareJob` and an architecture test.
- The silent-failure mode above requires a boot-time and CI assertion, plus `/health/isolation` ([Observability](../30-architecture/observability.md)).
- A noisy tenant shares resources with others. Mitigated by per-tenant rate limits.

**Benefits.**

- One migration path regardless of tenant count — directly addressing the §J.3 capacity risk.
- Isolation survives application bugs. A forgotten scope, a raw query or a stray primary-key lookup returns nothing rather than someone else's patients.
- Fast provisioning: a tenant is a row, supporting the under-one-day onboarding target.
- Cross-cutting platform operations remain straightforward.

**Forecloses.** Per-tenant schema customisation, which we do not want anyway ([White-Labeling](../10-product/white-labeling-and-branding.md) — variation is support cost). Per-tenant database-level backup granularity; tenant-level recovery is an extract-and-reinsert operation ([Disaster Recovery](../30-architecture/disaster-recovery.md)).

## Revisit when

- A tenant's data volume genuinely warrants isolation for performance rather than security. The likely answer even then is a dedicated deployment for that tenant, not a change of model.
- A regulation requires physical separation of one clinic's data.
- The tenant count reaches a scale where a shared table becomes a performance problem — partitioning by `tenant_id` comes first, well before changing the model.

**Not** because RLS feels unfamiliar. Familiarity is not a security property.

## Related

[Multi-Tenancy](../30-architecture/multi-tenancy.md) · [Threat Model](../50-security-compliance/threat-model.md) · [Test Strategy](../80-quality/test-strategy.md) · [ADR-0001](0001-laravel-nextjs-stack.md)
