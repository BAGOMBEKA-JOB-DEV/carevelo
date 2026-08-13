# AGENTS.md — guidance for AI agents working in this repository

Read this before writing anything. It is short on purpose.

Every rule here is stated in full somewhere in [docs/](docs/) and linked. **This file is a summary with links, never the source of truth** — if this file and a document disagree, the document wins, and the disagreement is a bug worth fixing.

---

## What this is

**Carevelo** is a white-label digital health platform for Uganda's licensed private clinics: teleconsultation, e-prescribing, dispensing handoff to the clinic's own pharmacy, delivery dispatch, and mobile-money collection — all under the clinic's own brand and the clinic's own regulatory licences.

Carevelo is a **software supplier and data processor only**. Each clinic is the data controller.

**Current state: documentation only. There is no application code yet.** The stack is decided — Laravel (PHP 8.3+) API, Next.js frontends, PostgreSQL 16+ with row-level security, Laravel Reverb for realtime ([ADR-0001](docs/70-decisions/0001-laravel-nextjs-stack.md), [ADR-0008](docs/70-decisions/0008-laravel-reverb-for-realtime.md)).

Start at [docs/README.md](docs/README.md). Its six-document reading order takes about an hour and is the fastest path to being useful here.

---

## Repository layout — the boundary you are most likely to break

```
carevelo/
  docs/        # describes the system — belongs to neither half
  backend/     # Laravel. NEVER contains frontend code
  frontend/    # Next.js workspace. NEVER contains PHP
```

> **Never write frontend code inside `backend/`, or backend code inside `frontend/`.**
>
> No Blade views for product surfaces. No Vite or Mix pipeline in Laravel. No Inertia, no Livewire. No PHP anywhere in the Next.js tree. No relative import that escapes either directory. No shared `lib/`, `common/` or `types/` at repository root.
>
> The two halves communicate **only** over the versioned HTTP API and authenticated WebSocket frames.
>
> **If a task seems to need a shared file, it does not** — it needs an API field, or a regenerated API client.

Laravel *may* render an email or a prescription PDF inside `backend/`. Those are documents, not UI.

**`frontend/` layout:**

```
frontend/
  apps/{patient-portal,clinic-console,platform-admin}
  packages/{ui,api-client,realtime}
```

`packages/` is shared **within `frontend/` only**.

**The API contract.** `docs/40-api/openapi.yaml` is the published contract. `frontend/packages/api-client` is **generated from it and committed** — so `frontend/` builds without knowing `backend/` exists. **Change the API → regenerate and commit the client in the same change.** A CI gate fails otherwise.

→ [ADR-0007](docs/70-decisions/0007-separate-backend-frontend-trees.md) · [Backend](docs/30-architecture/backend-laravel.md) · [Frontend](docs/30-architecture/frontend-nextjs.md)

---

## Hard rules — never violate

These are not style preferences. Each one keeps Carevelo out of a licensing regime it cannot survive. **No amount of customer demand, convenience, or "just for testing" changes them.**

### 1. Carevelo never employs or contracts clinicians

Every clinical act is performed by a clinician registered with the UMDPC, AHPC or Nurses & Midwives Council, engaged by *the clinic*. Employing them would make Carevelo a healthcare provider subject to UMDPC facility licensing and liability for clinical outcomes.

**In code:** `Clinician` exists only within a tenant. **There is no platform-level clinician.** Prescriptions carry the clinician's own name and registration number, snapshotted at issue.

**Never build:** a Carevelo clinician marketplace; triage or advice from Carevelo; clinical decision support; differential suggestion; dosage or **drug-interaction checking**. That last one *sounds* like an obvious safety feature — shipping it implies a duty of care we cannot discharge.

→ [Non-Goals](docs/10-product/non-goals.md) · [Domain Model](docs/20-domain/domain-model.md)

### 2. Carevelo never holds or dispenses drugs

Medicines are held, priced, dispensed and handed over by the clinic's own NDA-licensed pharmacy under the NDPA Act Cap 206.

**In code:** no platform stock ledger. `DispenseOrder` is always tenant-owned. Dispensing is always recorded against a **named pharmacist of the tenant**. Controlled items (`is_controlled = true`) are excluded from the delivery flow entirely, with no override.

**Never build:** platform-owned inventory; a medicine marketplace; drug procurement; any margin on medicines; a Carevelo delivery fleet.

→ [H4](docs/10-product/prd-h4-prescription-dispensing-delivery.md) · [Non-Goals](docs/10-product/non-goals.md)

### 3. Carevelo never takes custody of patient funds

Payment is initiated against the **clinic's own** merchant account at a BoU-licensed aggregator, using the **clinic's own** credentials. Funds settle directly to the clinic. Custody would trigger the NPS Act 2020 PSP or e-money-issuer categories — UGX 250m–10bn capital.

**Forbidden identifiers.** These name entities that must not exist, and a CI check fails the build on them:

```
wallet   balance   float   escrow   payout   settlement
```

**Renaming a variable to pass the check is not compliance.** The check is blunt on purpose — it forces a conversation, and the conversation is the control.

**Never build:** a wallet, float, escrow, hold-and-release, platform settlement account, payout, platform-initiated refund, or any stored value. Carevelo cannot refund — it holds nothing to refund from; the clinic refunds through its own aggregator.

→ [Payments Regulatory Boundary](docs/50-security-compliance/payments-regulatory-boundary.md) (normative) · [ADR-0003](docs/70-decisions/0003-non-custodial-payment-architecture.md)

### 4. Carevelo does not verify licences

UMDPC and NDA references are recorded as the clinic's **own attestation**. We have no access to those registers. Never build a "verified clinic" badge or any UI implying we checked — it would be false, and a patient might rely on it.

---

## Tenancy invariants

Tenant isolation is a **legal requirement**, not a feature. Each clinic is a separate data controller of special-category health data; a cross-tenant leak is a notifiable breach affecting two controllers at once — and our tenants are frequently each other's local competitors.

Read [Multi-Tenancy](docs/30-architecture/multi-tenancy.md) in full before touching anything tenant-scoped.

| Rule | Why |
|---|---|
| **`tenant_id` on every clinical and commercial row** | A new table is *presumed* tenant-scoped. Platform-scoped tables are enumerated in the doc; adding one means updating that list in the same change |
| **RLS enabled *and forced* in the same migration that creates the table** | Use the `Schema::enableTenantIsolation()` macro so it cannot be half-applied |
| **Composite foreign keys on `(tenant_id, id)`** | Makes a cross-tenant reference structurally impossible, not merely forbidden |
| **Every `ShouldQueue` extends `TenantAwareJob`** or carries `#[PlatformScoped]` | The request context is gone when a job runs. An architecture test enforces this |
| **Every cache key is tenant-namespaced** | A manually built key without a tenant prefix is a cross-tenant leak with a time delay |
| **Every broadcast channel name is tenant-prefixed** | Same defect as the cache key, but **pushed live** to the wrong subscriber. `private-tenant.{tenantId}.…`, always |
| **Tenant identity never comes from client input** | Host or session only. Never a path, query, header or body field |
| **The app role is not the table owner and holds `NOBYPASSRLS`** | See failure mode 1 below |

**Eloquent global scopes are a convenience layer. RLS is the control.** These all bypass a global scope and are all defeated by RLS:

```php
DB::table('patients')->get();          // query builder ignores Eloquent scopes
DB::select('select * from patients');  // raw SQL
Model::withoutGlobalScopes()->get();   // occasionally legitimate
Patient::find($idFromRequest);         // ← the dangerous one: looks completely normal
```

---

## Disclosure rules

Health data is special-category under DPPA 2019. **Including the mere fact that someone is a patient of a specific clinic** — which is why sign-in must not reveal whether a phone number is registered, and cross-tenant resources return **404, not 403**.

Each of these already has a test specified in [Test Strategy](docs/80-quality/test-strategy.md).

| Never put clinical data in | Instead |
|---|---|
| **A log line or exception trace** | Identifiers only (`patient_id`, `prescription_id`). Scrub trace arguments — that is where secrets escape |
| **An SMS or WhatsApp template** | "Your prescription from {Clinic} is ready." Never the medicine. Assume the operator reads every message |
| **An error response** | No clinical content, no stack trace, no internal detail |
| **An audit event** | It records *that* something happened to *which* record, never what the record said |
| **A rider payload** | Recipient, phone, address, package reference. **A distinct resource class with no clinical fields** — not the dispatcher resource with fields hidden in the UI |
| **A Reverb broadcast payload** | Identifiers and state only: `{order_id, status}`. A frame is a disclosure surface exactly as an SMS is, and a role channel fans out to several subscribers at once |

Also never: aggregator credentials in any response or log (write-only, envelope-encrypted, unreadable by *every* role including platform roles); production data in a non-production environment; `APP_DEBUG=true` in production.

→ [Data Protection](docs/50-security-compliance/data-protection-dppa.md) · [Observability](docs/30-architecture/observability.md) · [Notifications](docs/10-product/notifications-sms-whatsapp.md)

---

## Ubiquitous language

[docs/20-domain/ubiquitous-language.md](docs/20-domain/ubiquitous-language.md) is authoritative. Class names, tables, API paths, events and prose all draw from it.

**If a concept is not on that list, it does not exist.** Adding one means editing that file in the same change.

Names chosen deliberately, where the obvious alternative is wrong:

- **`PaymentIntent`**, not `Payment` or `Transaction` — we record an *attempt*; we do not effect payments.
- **`Tenant`**, not organisation, practice, facility or account.
- **`DispenseOrder`** separate from **`Prescription`** — what was *prescribed* and what was *dispensed* are different facts, and the prescription is immutable.
- **`ConsentRecord`** — immutable; withdrawal is a new record, never an update.

Conventions: `StudlyCase` classes, `snake_case` plural tables, `kebab-case` plural API paths, `snake_case` JSON, past-tense domain events (`PrescriptionIssued`), `_at` timestamps, assertion-style booleans (`is_controlled`).

**Money is always an integer minor unit with an explicit currency**, wrapped in the `Money` value object. Never a float — UGX has no subunit in practice, but the rule holds so the type never has to change.

---

## Immutability

These are corrected by **addition, never overwrite**. A medical record that can be silently rewritten is not a medical record.

| Entity | How to change it |
|---|---|
| `Prescription` | Cancel and issue a replacement with `supersedes_prescription_id` |
| `ClinicalNote` | New note of type `addendum` with `supersedes_note_id` |
| `ConsentRecord` | New record recording the withdrawal |
| `AuditEvent` | **Nothing.** The app role holds `INSERT`/`SELECT` and is denied `UPDATE`/`DELETE` at the database |

**No role can edit a prescription or delete a clinical note** — not the clinician, not the administrator, not Carevelo. That absence is deliberate.

---

## Before you start — what to read

| If you are touching | Read first |
|---|---|
| Anything at all | [docs/README.md](docs/README.md) reading order |
| Repository structure | [ADR-0007](docs/70-decisions/0007-separate-backend-frontend-trees.md) |
| A new table or model | [Multi-Tenancy](docs/30-architecture/multi-tenancy.md), [Domain Model](docs/20-domain/domain-model.md) |
| Payments | [Payments Regulatory Boundary](docs/50-security-compliance/payments-regulatory-boundary.md), [H5](docs/10-product/prd-h5-payments-non-custodial.md), [Webhooks](docs/40-api/webhooks.md) |
| Auth or permissions | [Auth](docs/40-api/authentication-and-sessions.md), [RBAC Matrix](docs/50-security-compliance/rbac-matrix.md) |
| A state transition | [State Machines](docs/20-domain/state-machines.md) |
| **The API contract** | [API Conventions](docs/40-api/api-conventions.md) — **then regenerate and commit `frontend/packages/api-client`** |
| An API endpoint | [API Conventions](docs/40-api/api-conventions.md), [Endpoint Catalogue](docs/40-api/endpoint-catalogue.md) |
| **Realtime / Reverb / a channel** | [Realtime Broadcasting](docs/30-architecture/realtime-broadcasting.md) |
| Notifications | [Notifications](docs/10-product/notifications-sms-whatsapp.md) |
| Anything patient-facing | [White-Labeling](docs/10-product/white-labeling-and-branding.md), [Frontend](docs/30-architecture/frontend-nextjs.md) |
| A queued job | [Multi-Tenancy](docs/30-architecture/multi-tenancy.md) queue hazard section |

**The PRD exception paths are the most valuable content in the repository and the most commonly dropped in implementation.** If you implement H3 without the no-show, dropped-call, mode-degradation and unsafe-for-remote-care branches, you have implemented perhaps half of it.

---

## The three highest-consequence failures

From [Threat Model](docs/50-security-compliance/threat-model.md). Each is silent, which is what makes them dangerous.

### 1. The application role owns the tables
PostgreSQL exempts a table's owner from RLS. If the app connects as the owner, **every policy becomes inert and the system works perfectly while protecting nothing.** No behavioural test notices.
→ Asserted at boot, in CI, and by `/health/isolation`. Never "fix" a permissions error by granting ownership.

### 2. A queued job without tenant context
The request context is gone. With RLS active the job sees zero rows and fails loudly — correct. **If failure 1 has also occurred, it sees everything.**
→ Extend `TenantAwareJob`. Never work around a "no tenant context" error by removing the guard.

### 3. A cache key without a tenant prefix
Tenant A's data served to tenant B, intermittently, under load. Passes every functional test and appears only in production.
→ Always use the tenant-namespaced cache abstraction.

---

## Before you finish

Condensed from [Definition of Done](docs/80-quality/definition-of-done.md).

**Every change:** exception paths implemented, not just the happy path · tests including failure cases · CI green · migration backward-compatible with the previous release · docs updated in the same change.

**Tenant-scoped data:** `tenant_id` present · RLS enabled and forced in the same migration · composite FKs · **a cross-tenant isolation test for every new model, exercising all four access paths** · jobs tenant-aware · cache keys namespaced.

**Clinical data:** minimum necessary in every response · immutability respected · access audited · nothing clinical in logs, notifications or errors · consent state respected.

**Payments:** no forbidden identifiers · tenant's own credentials · credentials unreachable from responses and logs · idempotency tested · callback amounts validated against the stored intent · reconciliation still resolves independently of the webhook.

**Auth:** policy exists, default deny · **denial tested, not just permission** · cross-tenant returns 404 · no client-supplied tenant.

### The three questions

Before merging anything substantial:

1. **Does this make Carevelo look like it employs clinicians?**
2. **Does this make Carevelo look like it handles drugs?**
3. **Does this make Carevelo hold anyone's money, even briefly?**

Any yes stops the change.

---

## Documentation rules

- Every document opens with a status header: `Status`, `Last reviewed`, `Derives from`.
- Requirements cite their origin — a business-plan section (`§H3`), an ADR, or a named statute. An unsourced requirement is an opinion.
- **Architecture and compliance documents change by ADR, not by silent edit.** Write the ADR first ([template](docs/70-decisions/adr-template.md)).
- Diagrams are **Mermaid, inline** — no binary images, because diagrams must be diffable. Conventions in [docs/README.md](docs/README.md).
- The business plan ([docs/00-overview/business-plan.md](docs/00-overview/business-plan.md)) is a **historical input**. Do not edit it.

---

## Verification

Available now:

```bash
# Link integrity — every relative Markdown link resolves
python3 - <<'EOF'
import os, re, urllib.parse
bad = []
for d, _, fs in os.walk('.'):
    if '.git' in d: continue
    for f in (x for x in fs if x.endswith('.md')):
        p = os.path.join(d, f)
        for i, line in enumerate(open(p), 1):
            for _, u in re.findall(r'\[([^\]]*)\]\(([^)]+)\)', line):
                if u.startswith(('http', '#', 'mailto')): continue
                t = urllib.parse.unquote(u.split('#')[0])
                if t and not os.path.exists(os.path.normpath(os.path.join(d, t))):
                    bad.append(f"{p}:{i} {u}")
print(f"broken links: {len(bad)}"); [print(b) for b in bad]
EOF

# Balanced code fences
for f in $(find . -name '*.md'); do
  n=$(grep -c '^```' "$f"); [ $((n % 2)) -ne 0 ] && echo "ODD FENCES: $f"
done
```

Once code exists, all CI gates block ([Release Process](docs/60-operations/release-process.md)): Pint · PHPStan level 8 · ESLint/TypeScript · unit and integration tests · **cross-tenant isolation tests** · **architecture tests** · **schema RLS test** · **forbidden-identifier check** · dependency scan · secret scan.

**An isolation-test failure blocks release.** There is no severity discussion to have.

---

## Things agents get wrong here

Specific to this repository, drawn from what the constraints make tempting:

- **Adding a `balance` column** because reconciliation would be easier. It is a legal boundary, not an inconvenience.
- **Adding drug-interaction checking** because it looks like a safety win. It implies a duty of care we cannot discharge.
- **A "verified clinic" badge.** We do not verify licences and must not imply it.
- **Sending the medicine name in the "prescription ready" SMS** because it is more helpful. SMS is not confidential.
- **Returning 403 for a cross-tenant resource** because it is semantically tidier. 403 confirms the resource exists.
- **Adding a field to the rider payload** "since it's already loaded". The rider resource has no clinical fields by design.
- **Making `national_id_number` required** for data quality. Requiring a NIN excludes patients, and exclusion is worse than unverified identity.
- **Building the abstraction before the second case exists.** A generalised provider interface written for one provider is a guess.
- **Treating a payment timeout as final.** `timed_out` can still become `succeeded` on a late mobile-money confirmation.
- **Implementing only the happy path.** The exception branches are the product.
