# ADR-0001 — Laravel + Next.js + PostgreSQL

> **Status:** Accepted
> **Date:** 2026-08-13
> **Derives from:** Business Plan §A, §M

## Context

A stack must be chosen before any code exists. Three constraints dominate, and none of them is technical elegance.

**Founder capacity is the binding risk.** §M names it directly: a solo, part-time founder running an ICT consultancy alongside this. §J ranks it a high-likelihood, high-impact risk. Every hour spent fighting unfamiliar tooling is an hour not spent with clinic owners, and §M is explicit that willingness-to-pay — not technology — is what decides whether this business exists.

**The founder's existing edge is specific.** §A: deep multi-tenant SaaS, PostgreSQL, EFRIS/URA, NIRA and mobile-money integration experience. Choosing a stack that discards this is choosing to start from zero.

**Hiring, later.** At the first support and engineering hire (~UGX 20m/month MRR, §K), the pool in Kampala matters. PHP and JavaScript are the deepest local pools by a wide margin.

Technical requirements: strict multi-tenant isolation, background jobs, PDF rendering, third-party HTTP integrations, server-rendered tenant-branded pages, and a patient surface that performs on a mid-range Android phone over mobile data.

## Options considered

### A. Laravel + Next.js + PostgreSQL — chosen

Laravel provides queues (Horizon), scheduling, policies, migrations, testing and API tooling as first-party, coherent pieces. PostgreSQL provides the row-level security that makes tenant isolation a database guarantee rather than an application promise ([ADR-0002](0002-postgresql-rls-shared-schema-tenancy.md)). Next.js gives server-rendered tenant branding — needed to avoid a flash of unbranded content on the patient portal — with a mature ecosystem.

**Against:** two languages and two toolchains for one small team. PHP carries reputational baggage in some investor conversations, though modern Laravel does not deserve it.

### B. Laravel with Blade/Livewire, no separate frontend

One language, one deployment, faster to build.

**Against:** the consultation surface needs real client-side state — WebRTC, live note drafting, reconnection handling. Livewire's server round-trips are poorly suited to it on the exact connections our patients have. Mobile apps, if ever needed, would have no API to build against.

### C. Node/TypeScript throughout (NestJS + Next.js)

One language. Excellent type safety end to end.

**Against:** discards the founder's stated PHP/Laravel and integration experience. NestJS gives less framework support out of the box than Laravel — queues, scheduling and admin tooling are assembled rather than provided. Directly contradicts the capacity constraint.

### D. Django + Next.js

Comparable framework maturity, excellent PostgreSQL support.

**Against:** same objection as C — outside the founder's stated experience, with no compensating advantage. Smaller local hiring pool than PHP.

### E. Java/Spring Boot + React

The conventional enterprise answer.

**Against:** heaviest development overhead per feature, slowest iteration, smallest local pool, and no advantage that matters at this scale. Enterprise-*grade* is about isolation, auditability and operational discipline — properties this documentation set specifies directly. It is not about the runtime.

## Decision

**Laravel 13 (PHP 8.3+) API backend, Next.js (React) frontends, PostgreSQL 16+, Redis, Laravel Horizon.**

Installed with the official Laravel installer (`laravel new backend --database=pgsql --pest --no-node --boost`), keeping the standard Laravel skeleton. Laravel 13 was released March 2026 and supports PHP 8.3–8.5.

Detailed in [Backend](../30-architecture/backend-laravel.md) and [Frontend](../30-architecture/frontend-nextjs.md).

## Consequences

**Accepted costs.** Two toolchains, two CI pipelines, two dependency trees. Some duplicated validation logic between API and client, mitigated by generating the TypeScript client from [openapi.yaml](../40-api/openapi.yaml). PHP's reputation may require explanation in an investor conversation; the answer is that Helium Health and comparable African health-tech run on similarly pragmatic stacks and no clinic has ever asked.

**Benefits.** The founder is productive on day one. Framework-provided queues, scheduling, policies and testing mean less bespoke infrastructure to maintain — directly addressing the §J.3 capacity risk. PostgreSQL RLS makes the most important security property a database guarantee. Server-rendered branding is straightforward. The local hiring pool is the deepest available.

**Forecloses.** Nothing important. The API boundary means the frontend could be replaced independently; the modular monolith means backend modules could be extracted ([ADR-0005](0005-modular-monolith-over-microservices.md)). PostgreSQL is the one genuinely load-bearing choice, and RLS is the reason.

## Revisit when

- A future team's composition makes PHP a genuine hiring constraint rather than an advantage.
- A requirement appears that Laravel handles materially worse — sustained high-throughput realtime is the plausible one, and even then it would be a separate service rather than a rewrite.

Not on aesthetic grounds. Rewrites are how small companies die.

## Related

[Backend](../30-architecture/backend-laravel.md) · [Frontend](../30-architecture/frontend-nextjs.md) · [ADR-0002](0002-postgresql-rls-shared-schema-tenancy.md) · [ADR-0005](0005-modular-monolith-over-microservices.md)
