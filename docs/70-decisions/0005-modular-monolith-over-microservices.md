# ADR-0005 — Modular monolith, not microservices

> **Status:** Accepted (directory layout superseded by [ADR-0009](0009-standard-laravel-layout.md); the reasoning stands)
> **Date:** 2026-08-13
> **Derives from:** Business Plan §J.3, §K, §M

## Context

The system spans several coherent areas — tenancy, scheduling, consultations, prescriptions, dispensing, delivery, payments, notifications — which invites a service-per-area design.

The constraint that decides it: **one part-time founder**, first support hire at roughly UGX 20m/month MRR, engineering hire later (§K). §J ranks founder capacity a high-likelihood, high-impact risk, and §M names burnout as a leading failure mode.

Scale is modest by design: 33 clinics at UGX 10m/month, ~165 at UGX 50m/month, 500+ at UGX 200m/month — a three-to-five-year goal. **A single PostgreSQL instance handles this comfortably.** There is no scaling problem that microservices would solve.

## Options considered

### A. Microservices

**For:** independent deployment and scaling; enforced boundaries; independent technology choices; failure isolation.

**Against, decisively at this scale:** distributed transactions across service boundaries — a prescription creating a dispense order becomes an eventual-consistency problem instead of a database transaction. Distributed tracing becomes necessary rather than useful. N deployment pipelines, N monitoring surfaces, N sets of credentials. Local development requires running everything.

And the specific problem here: **tenant context must propagate across every service boundary.** Each hop is a place isolation can break, and isolation is a legal requirement ([ADR-0002](0002-postgresql-rls-shared-schema-tenancy.md)). Multiplying those boundaries multiplies the risk of the exact failure we least tolerate.

Microservices solve organisational scaling — many teams deploying independently. **We have one person.**

### B. Unstructured monolith

Fast initially, and it degrades. Modules grow into each other, boundaries erode, and by the time a second engineer arrives nobody can work without understanding everything. Extraction later becomes impossible because the seams were never there.

### C. Modular monolith — chosen

One deployable application with **enforced** internal boundaries. Modules communicate through published contracts and domain events. Boundaries are asserted by architecture tests, not by convention.

## Decision

**A modular monolith.** One Laravel application, modules under `app/Modules/`, boundaries enforced by tests.

Rules ([Backend](../30-architecture/backend-laravel.md)):

1. A module may not reference another module's `Domain` or `Infrastructure`. Cross-module interaction goes through published `Application` contracts or domain events.
2. `Domain` contains no framework code — no Eloquent, no facades, no `request()`.
3. Domain events are the default for cross-module communication.
4. `Support` may be referenced by anything and references nothing.

Enforced by architecture tests in CI. **A boundary that is not tested is a convention, and conventions erode.**

## Consequences

**Accepted costs.**

- All modules deploy together; one module's bug can take down the application. Mitigated by testing, health checks and rolling deploys with automatic rollback.
- Scaling is uniform — the whole application scales even if only payments is busy. At our volumes this is cheaper than the alternative, by a wide margin.
- Discipline is required. Architecture tests replace the physical impossibility that service boundaries provide.
- One technology stack for everything. Given [ADR-0001](0001-laravel-nextjs-stack.md), this is a benefit.

**Benefits.**

- **Database transactions across module boundaries.** A prescription and its dispense order commit atomically, in one transaction, with no saga and no compensating action.
- **Tenant context propagates trivially** — one process, one request, one `SET LOCAL`. No cross-service context propagation to get wrong ([Multi-Tenancy](../30-architecture/multi-tenancy.md)).
- One deployment, one log stream, one monitoring surface, one set of credentials. A single operator can hold the whole system in their head.
- Local development is `php artisan serve`.
- **Extraction stays possible.** Enforced boundaries mean a module could become a service when there is a team to justify it.

**Forecloses.** Nothing permanently. Independent scaling and per-module technology choices are unavailable — neither is needed, and both would cost more than they return at this scale.

## Revisit when

- **The team is large enough that deployment coordination is a real cost** — realistically three or more engineers working in parallel. Even then, extract the one module that hurts, not all of them.
- One module has genuinely different scaling characteristics. Realtime is the plausible candidate, and it is already partly external ([Realtime & Video](../30-architecture/realtime-and-video.md)).
- A module needs a different runtime for a specific reason.

**Not** because microservices are the default answer in architecture discussions. At this scale they would trade a solvable problem for several unsolvable ones.

## Related

[Backend](../30-architecture/backend-laravel.md) · [System Context](../30-architecture/system-context.md) · [ADR-0001](0001-laravel-nextjs-stack.md) · [ADR-0002](0002-postgresql-rls-shared-schema-tenancy.md)
