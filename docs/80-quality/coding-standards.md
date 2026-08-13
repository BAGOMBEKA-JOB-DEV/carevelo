# Coding Standards

> **Status:** Draft
> **Last reviewed:** 2026-08-13
> **Derives from:** [Ubiquitous Language](../20-domain/ubiquitous-language.md), [Backend](../30-architecture/backend-laravel.md)

Style is automated so it is not discussed. This document covers the parts a formatter cannot enforce.

## The tree boundary

Before anything else: **`backend/` and `frontend/` never reach into each other** ([ADR-0007](../70-decisions/0007-separate-backend-frontend-trees.md)).

| Never | |
|---|---|
| PHP anywhere under `frontend/` | |
| Blade views for product surfaces, Vite/Mix, Inertia or Livewire under `backend/` | Emails and prescription PDFs are documents, not UI — those are fine |
| An import or relative path escaping either tree | |
| A shared `lib/`, `common/` or `types/` at repository root | |
| Hand-written API types in `frontend/` | Generated from `openapi.yaml` and committed |

**If a change seems to need a shared file, it needs an API field instead.** Enforced by a CI tree-boundary check.

## Automated

Each tree has its own tooling and its own pipeline.

| Tool | Tree |
|---|---|
| Laravel Pint (PSR-12) | `backend/` |
| PHPStan / Larastan, level 8 | `backend/` |
| Pest | `backend/` |
| ESLint + Prettier | `frontend/` |
| TypeScript, strict | `frontend/` |
| Vitest, Playwright | `frontend/` |

All blocking in CI. **Formatting is never a review comment** — if it passed the formatter, it is correct.

## Naming

From [Ubiquitous Language](../20-domain/ubiquitous-language.md), which is the authority:

| Layer | Convention | Example |
|---|---|---|
| PHP classes | `StudlyCase`, singular | `DispenseOrder` |
| Tables | `snake_case`, plural | `dispense_orders` |
| Columns | `snake_case` | `dispensed_at` |
| API paths | `kebab-case`, plural | `/v1/dispense-orders` |
| JSON fields | `snake_case` | `dispensed_at` |
| Domain events | past tense | `PrescriptionIssued` |
| Jobs | imperative | `DispatchDelivery` |
| States | `snake_case` | `awaiting_payment` |

Timestamps end `_at`. Booleans read as assertions — `is_controlled`, `requires_delivery`. Money is `_minor` with an explicit currency column.

**If a concept is not in the ubiquitous language, it does not exist.** Adding one means editing that document in the same change.

Never use the words in its "do not use" table: "our clinician", "our pharmacy", "customer", bare `user`, bare `order`.

Separately and more seriously, the **forbidden identifiers** — `wallet`, `balance`, `float`, `escrow`, `payout`, `settlement` — are not a naming preference. They name entities that must not exist, their absence is a compliance control, and a CI check fails the build on them. [Payments Regulatory Boundary](../50-security-compliance/payments-regulatory-boundary.md) is the normative source for that list; do not restate it elsewhere, and do not satisfy the check by renaming a variable.

## Money

```php
$total = new Money(15_000_00, Currency::UGX);   // always the value object
$total = 15000.00;                              // never a float
```

UGX has no subunit in practice; the integer-minor rule holds anyway so the type never has to change.

## Time

`timestamptz`, stored UTC, displayed `Africa/Kampala`. Inject a `Clock` rather than calling `now()` inside domain code — untestable time is the commonest cause of a flaky test.

## Domain code

`Domain` contains **no framework code** — no Eloquent, no facades, no `request()`, no `config()`. That is what makes invariants testable without a database ([Backend](../30-architecture/backend-laravel.md)).

State changes are methods that throw on an illegal transition:

```php
$order->dispense($pharmacistId, $clock);   // yes
$order->status = 'dispensed';              // never
```

Invariants live in the aggregate, where a controller in a hurry cannot bypass them.

## Queries

Never build SQL from client input. Filter and sort fields are allow-listed ([API Conventions](../40-api/api-conventions.md)).

`DB::table()` and raw SQL are permitted — RLS protects them — but **prefer Eloquent** so the convenience layer stays consistent, and always with bound parameters.

`withoutGlobalScopes()` requires a comment explaining why. It is occasionally legitimate and always worth a second look.

## Jobs

Every `ShouldQueue` class extends `TenantAwareJob` or carries `#[PlatformScoped]`. Enforced by architecture test; the standard is written here so the test failure is understood rather than worked around.

Jobs are idempotent and carry a deterministic key where they have an external effect.

## Cache

Always through the tenant-namespaced abstraction. **A manually constructed key is a defect** — an unprefixed key is a cross-tenant leak with a time delay, appearing intermittently and only under load ([Threat Model](../50-security-compliance/threat-model.md)).

## Broadcast channels

The same rule, one degree sharper. Channel names are built through the tenant-aware helper, never concatenated by hand:

```php
Broadcast::channel('tenant.{tenantId}.pharmacy-queue', ...);   // yes
Broadcast::channel('pharmacy-queue', ...);                     // NEVER
```

An unprefixed channel does not wait for a request to leak — it **pushes** another tenant's data to a subscriber. Payloads carry identifiers and state only; never clinical content ([Realtime Broadcasting](../30-architecture/realtime-broadcasting.md)).

Broadcasts are emitted from domain events, never from controllers.

## Logging

Identifiers and outcomes, never content ([Observability](../30-architecture/observability.md)):

```php
Log::info('prescription.issued', [
    'prescription_id' => $p->id,
    'clinician_id'    => $p->clinicianId,
]);                                        // yes

Log::info("Prescribed {$medicine} to {$patient->name}");   // never
```

## Comments

Explain **why**, not what. The code says what it does.

Comment when: a decision is non-obvious, a workaround exists for an external quirk, a regulatory constraint drives the shape of the code, or a future reader would otherwise "simplify" something load-bearing.

Regulatory constraints especially deserve a comment and a link — the next person to read `Payments` should encounter the reason before they encounter the temptation:

```php
// Non-custodial: funds settle directly to the clinic's own account.
// Never introduce a platform balance — see
// docs/50-security-compliance/payments-regulatory-boundary.md
```

## Frontend

Server components by default; client components only where interactivity requires. Colocate by feature. No tenant-supplied value ever reaches `dangerouslySetInnerHTML` or a `<style>` block ([White-Labeling](../10-product/white-labeling-and-branding.md)).

Generated API client from [openapi.yaml](../40-api/openapi.yaml) — never hand-written request types, which drift.

## Commits and pull requests

Conventional commits: `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`. Scope where useful — `feat(dispensing): …`.

Subject in the imperative, under 72 characters. Body explains **why** where the change is not self-evident.

Pull requests: one logical change; description says what and why; link the PRD or issue; note anything a reviewer should look at closely.

**Never commit** secrets, `.env`, production data, or large binaries. Secret scanning blocks these, and it should never be the thing that catches them.

## Dependencies

Add deliberately. Every dependency is supply-chain risk in a system holding health data — the realistic compromise scenario ([Threat Model](../50-security-compliance/threat-model.md)).

Before adding, ask: is it maintained, how large is its own dependency tree, and could a small amount of our own code do it? Vulnerability scanning is blocking in CI.

Prefer first-party Laravel packages, which is a large part of why Laravel was chosen ([ADR-0001](../70-decisions/0001-laravel-nextjs-stack.md)).
