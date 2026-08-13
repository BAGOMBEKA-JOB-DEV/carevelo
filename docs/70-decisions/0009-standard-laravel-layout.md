# ADR-0009 — Standard Laravel layout, not `app/Modules/`

> **Status:** Accepted
> **Date:** 2026-08-13
> **Supersedes the layout in:** [ADR-0005](0005-modular-monolith-over-microservices.md) (the modular-monolith *reasoning* stands; only the directory scheme changes)

## Context

[ADR-0005](0005-modular-monolith-over-microservices.md) chose a modular monolith and [backend-laravel.md](../30-architecture/backend-laravel.md) specified `app/Modules/{Tenancy,Scheduling,…}/{Domain,Application,Infrastructure,Http}` — a layout imported from DDD practice rather than from Laravel.

Implementation showed three problems with it.

**Artisan does not generate into it.** `make:model`, `make:policy`, `make:cast`, `make:rule` and `make:migration` all place files in Laravel's conventional directories. Every generated file would have needed moving and its namespace rewriting, on every single generation.

**It contradicts the framework's own guidance.** Laravel Boost — installed in this project and written by Laravel's maintainers — instructs agents to "stick to existing directory structure; don't create new base folders without approval" and to use `php artisan make:` for new files. Two authorities in one repository giving opposite instructions is a defect in the documentation, not in the framework.

**It removes the benefit Laravel is chosen for.** [ADR-0001](0001-laravel-nextjs-stack.md) selected Laravel because a small team is productive in it immediately and because Kampala's hiring pool knows it. A bespoke directory scheme means a new engineer's Laravel knowledge stops at the `app/` boundary.

The project owner was also direct about this during implementation: use Laravel's structure, not an invented one.

## Decision

**Use the standard Laravel layout.** Files go where `php artisan make:` puts them.

```
app/
  Models/          + Concerns/, Scopes/   models, enums, state machines
  Http/            Controllers/Api/V1/, Middleware/, Resources/V1/
  Policies/        authorisation, default-deny
  Jobs/            TenantAwareJob and descendants
  Casts/           MoneyCast, PhoneNumberCast
  Rules/           UgandanPhone
  Providers/       TenancyServiceProvider
  Tenancy/         TenantContext, Tenancy
  Audit/           AuditLog
  Support/         Money, PhoneNumber, ReferenceGenerator, StateMachine/
  Exceptions/      Tenancy/, StateMachine/
```

`app/Tenancy`, `app/Audit` and `app/Support` are the only additions to the stock skeleton. Each groups a cross-cutting concern that has no conventional Laravel home, and each is a leaf that the rest of the application depends on rather than a parallel architecture.

## What is kept from ADR-0005

The *reasoning* was never about directories. It was that a distributed system is a tax paid daily by a team that does not exist, that database transactions across module boundaries are worth more than independent deployability at this scale, and that tenant context propagates trivially in one process. All of that still holds — this remains one deployable application.

What is lost is the architecture test enforcing module boundaries, since there are no module directories to enforce between. Replaced by:

- **Policies as the authorisation boundary** — default-deny, tested for refusal as well as permission.
- **Models owning their invariants** — transitions are methods that throw; `Prescription::issue()` enforces both prescribing preconditions, and no controller can bypass them.
- **`Domain`-style purity kept where it pays**: `app/Support` holds no framework code, so `Money`, `PhoneNumber` and the state machines unit-test without a database.

## Consequences

**Accepted costs.** No compiler-enforced module boundary; a controller *could* reach any model. Mitigated by policies, model-level invariants and review. If the codebase later grows past what one team can hold, extraction to modules is a mechanical refactor — the invariants are already in the models rather than scattered.

**Benefits.** `php artisan make:` works unmodified. A Laravel developer is productive immediately. Boost's guidance and the repository's own docs now agree. Framework upgrades stay routine.

## Revisit when

Several engineers work in parallel and conventional directories become a merge-conflict surface — realistically three or more. Even then, extract the one area that hurts rather than restructuring wholesale.

## Documents to update

[backend-laravel.md](../30-architecture/backend-laravel.md) — replace the `app/Modules/` tree with the layout above. [ADR-0005](0005-modular-monolith-over-microservices.md) gains a pointer here.

## Related

[ADR-0001](0001-laravel-nextjs-stack.md) · [ADR-0005](0005-modular-monolith-over-microservices.md) · [ADR-0007](0007-separate-backend-frontend-trees.md) · [Backend](../30-architecture/backend-laravel.md)
