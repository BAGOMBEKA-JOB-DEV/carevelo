# Carevelo Documentation

This tree is the system of record for what Carevelo is, why it is shaped the way it is, and what may never be built into it. Application code is downstream of these documents; where code and documentation disagree, one of them is a bug.

## Reading order for a new engineer

Read these six, in order, before touching anything else. They take about an hour and they are enough to make you dangerous in the right direction.

1. [Vision & Scope](00-overview/vision-and-scope.md) — what Carevelo is, and the three things it must never become.
2. [Glossary](00-overview/glossary.md) — Ugandan regulatory and payments vocabulary. Do not skip; most of the acronyms are load-bearing.
3. [Personas & Actors](00-overview/personas-and-actors.md) — who uses the system and what each may see.
4. [Domain Model](20-domain/domain-model.md) — the aggregates and their invariants.
5. [Multi-Tenancy](30-architecture/multi-tenancy.md) — how one clinic is prevented from reading another's patients. This is a legal requirement, not a feature.
6. [Payments Regulatory Boundary](50-security-compliance/payments-regulatory-boundary.md) — why money never flows through a Carevelo account.

Then, before writing any code, [ADR-0007](70-decisions/0007-separate-backend-frontend-trees.md) — the `backend/` and `frontend/` boundary, which is the structural rule most easily broken by accident.

When you have finished, you should be able to answer three questions without looking anything up: **who holds the money, who issues the prescription, and what stops clinic A reading clinic B's patients.** If you cannot, the fault is in the documents — please raise it.

## Index

### 00 — Overview

| Document | Purpose |
|---|---|
| [Business Plan](00-overview/business-plan.md) | The researched commercial case. Source of truth for market, pricing, regulation. All other docs derive from it. |
| [Vision & Scope](00-overview/vision-and-scope.md) | Product definition and the hard boundaries. |
| [Glossary](00-overview/glossary.md) | Regulatory, clinical and payments terminology. |
| [Personas & Actors](00-overview/personas-and-actors.md) | Human and system actors. |
| [Roadmap](00-overview/roadmap.md) | Phases 0–3 with go/kill gates. |

### 10 — Product

| Document | Purpose |
|---|---|
| [H1 — Clinic Onboarding](10-product/prd-h1-clinic-onboarding.md) | First contact to first consultation. |
| [H2 — Patient Registration & Consent](10-product/prd-h2-patient-registration-consent.md) | DPPA-compliant registration. |
| [H3 — Teleconsultation](10-product/prd-h3-teleconsultation.md) | Book → pay → consult → notes → prescription. |
| [H4 — Prescription, Dispensing & Delivery](10-product/prd-h4-prescription-dispensing-delivery.md) | Pharmacy queue through to the patient's door. |
| [H5 — Payments (Non-Custodial)](10-product/prd-h5-payments-non-custodial.md) | Collection, states, reconciliation. |
| [White-Labeling & Branding](10-product/white-labeling-and-branding.md) | How a clinic's brand is applied safely. |
| [Notifications](10-product/notifications-sms-whatsapp.md) | SMS/WhatsApp rules, including what must never be sent. |
| [Non-Goals](10-product/non-goals.md) | What we deliberately do not build, and why. |
| [Phase 2 & 3 Outline](10-product/phase-2-3-outline.md) | Deferred scope and the hooks left for it. |

### 20 — Domain

| Document | Purpose |
|---|---|
| [Ubiquitous Language](20-domain/ubiquitous-language.md) | The nouns and verbs the code must use. |
| [Domain Model](20-domain/domain-model.md) | Aggregates, invariants, ERD. |
| [State Machines](20-domain/state-machines.md) | Legal transitions for every stateful entity. |
| [Identifiers & Numbering](20-domain/identifiers-and-numbering.md) | IDs, human references, idempotency keys. |

### 30 — Architecture

| Document | Purpose |
|---|---|
| [System Context](30-architecture/system-context.md) | C4 levels 1 and 2. |
| [Multi-Tenancy](30-architecture/multi-tenancy.md) | Tenant isolation via PostgreSQL RLS. |
| [Backend (Laravel)](30-architecture/backend-laravel.md) | Modular monolith layout, queues, events. |
| [Frontend (Next.js)](30-architecture/frontend-nextjs.md) | Three surfaces, theming, session handling. |
| [Realtime & Video](30-architecture/realtime-and-video.md) | Consultation **media** transport and low-bandwidth fallback. |
| [Realtime Broadcasting](30-architecture/realtime-broadcasting.md) | Laravel Reverb — channels, authorisation, payload rules. |
| [Integrations](30-architecture/integrations.md) | Aggregators, SMS, WhatsApp. |
| [Data Residency & Hosting](30-architecture/data-residency-and-hosting.md) | Where data lives and why. |
| [Environments & Deployment](30-architecture/environments-and-deployment.md) | Environments, pipeline, migrations. |
| [Observability](30-architecture/observability.md) | Logs, metrics, traces — and PII-safe logging. |
| [Disaster Recovery](30-architecture/disaster-recovery.md) | RPO/RTO and restore drills. |

### 40 — API

| Document | Purpose |
|---|---|
| [API Conventions](40-api/api-conventions.md) | Versioning, errors, pagination, idempotency. |
| [Authentication & Sessions](40-api/authentication-and-sessions.md) | Sanctum, scopes, OTP, tenant resolution. |
| [Endpoint Catalogue](40-api/endpoint-catalogue.md) | Endpoints grouped by bounded context. |
| [Webhooks](40-api/webhooks.md) | Inbound aggregator callbacks, verification, replay. |
| [openapi.yaml](40-api/openapi.yaml) | Machine-readable skeleton. |

### 50 — Security & Compliance

| Document | Purpose |
|---|---|
| [Threat Model](50-security-compliance/threat-model.md) | STRIDE over tenancy, payments and PHI. |
| [RBAC Matrix](50-security-compliance/rbac-matrix.md) | Role × resource × action. |
| [Data Protection (DPPA 2019)](50-security-compliance/data-protection-dppa.md) | Consent, special-category data, PDPO. |
| [Retention & Deletion](50-security-compliance/data-retention-and-deletion.md) | Lifecycles and clinic offboarding. |
| [Audit Logging](50-security-compliance/audit-logging.md) | What is recorded immutably and who may read it. |
| [Payments Regulatory Boundary](50-security-compliance/payments-regulatory-boundary.md) | The non-custodial architecture. |
| [Incident Response](50-security-compliance/incident-response.md) | Breach handling and notification. |
| [Compliance Responsibility Matrix](50-security-compliance/compliance-responsibility-matrix.md) | Who owns which obligation. |

### 60 — Operations

| Document | Purpose |
|---|---|
| [Clinic Onboarding Runbook](60-operations/clinic-onboarding-runbook.md) | The under-one-day onboarding procedure. |
| [Support & SLA](60-operations/support-and-sla.md) | Channels, hours, severities. |
| [Release Process](60-operations/release-process.md) | How change reaches production. |
| [Backup & Restore](60-operations/backup-and-restore.md) | Backup regime and verification. |

### 70 — Decisions (ADRs)

| ADR | Decision |
|---|---|
| [template](70-decisions/adr-template.md) | ADR format. |
| [0001](70-decisions/0001-laravel-nextjs-stack.md) | Laravel + Next.js + PostgreSQL. |
| [0002](70-decisions/0002-postgresql-rls-shared-schema-tenancy.md) | Shared-schema tenancy enforced by RLS. |
| [0003](70-decisions/0003-non-custodial-payment-architecture.md) | Non-custodial payments. |
| [0004](70-decisions/0004-video-provider-selection.md) | Consultation video transport. |
| [0005](70-decisions/0005-modular-monolith-over-microservices.md) | Modular monolith. |
| [0006](70-decisions/0006-audit-log-immutability.md) | Append-only audit log. |
| [0007](70-decisions/0007-separate-backend-frontend-trees.md) | Separate `backend/` and `frontend/` trees, API-only boundary. |
| [0008](70-decisions/0008-laravel-reverb-for-realtime.md) | Laravel Reverb for realtime. |
| [0009](70-decisions/0009-standard-laravel-layout.md) | Standard Laravel layout, not `app/Modules/`. |
| [0010](70-decisions/0010-patient-account-link.md) | One account, many patient records — and why the index path is the sharp edge. |

### 80 — Quality

| Document | Purpose |
|---|---|
| [Test Strategy](80-quality/test-strategy.md) | What we test and to what depth. |
| [Definition of Done](80-quality/definition-of-done.md) | The bar for merging. |
| [Coding Standards](80-quality/coding-standards.md) | Style, naming, commits. |

## Conventions

**Status header.** Every document opens with a metadata block:

```
> **Status:** Draft | Reviewed | Approved
> **Last reviewed:** YYYY-MM-DD
> **Derives from:** Business Plan §X
```

`Draft` means written but not yet challenged. `Reviewed` means a second person has read it against the business plan. `Approved` means it may be cited as binding — architecture and compliance documents must reach `Approved` before the code they describe is merged.

**Traceability.** Anything asserted as a requirement cites its origin: a business-plan section (`§H3`), an ADR, or a named Ugandan statute. An unsourced requirement is an opinion and should be marked as one.

**Diagrams** are Mermaid, inline in the Markdown. No binary image files — diagrams must be diffable, and a diagram that cannot be reviewed in a pull request will drift from the system it claims to describe.

### Diagram conventions

A diagram earns its place by showing a **mechanism that prose renders poorly**: a sequence, a lifecycle, a boundary, a race condition, a dependency graph. A diagram that restates a bullet list is decoration, and decoration rots.

| Use | For |
|---|---|
| `sequenceDiagram` | Flows across actors — booking, payment, dispensing |
| `stateDiagram-v2` | Entity lifecycles and legal transitions |
| `flowchart` / `graph` | Structure, dependencies, decision paths |
| `erDiagram` | Data relationships |

Rules that keep them rendering everywhere:

- **Quote any node label containing punctuation.** Bare apostrophes, semicolons, parentheses and slashes break some parsers.
- **Never put `;` in an edge label** — it is a statement separator.
- Keep `flowchart`/`graph` diagrams under roughly 15 nodes. Split rather than sprawl.
- **Colour marks the security- or compliance-critical element only** — never decoration. The convention in use: teal for the platform boundary, blue for the RLS-enforced data layer, amber for the clinic's own funds, red for a forbidden or failure state.
- **A sentence before each diagram** saying what to look at. Where the diagram makes a non-obvious point, **a sentence after it** saying what the point is. A diagram left to speak for itself usually says the wrong thing.

**Numbering** is by directory prefix (`00`–`80`). Prefixes are stable; files may be added within a directory without renumbering.

**Changing a document.** Architecture and compliance documents change by ADR, not by silent edit. If a change alters a decision, write the ADR first and let the document reference it.
