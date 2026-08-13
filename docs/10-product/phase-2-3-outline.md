# Phase 2 & 3 Outline

> **Status:** Draft
> **Last reviewed:** 2026-08-13
> **Derives from:** Business Plan §C, §K, §L

Deferred scope, and — more usefully — the **hooks** the MVP must leave behind so that adding these later is an extension rather than a rewrite. Nothing here is committed. Each item is gated on the phase criteria in [Roadmap](../00-overview/roadmap.md).

The discipline: leave the hook, do not build the feature. A hook is a schema shape or an interface boundary that costs nothing now and saves a migration later.

## Phase 2 (months 6–18)

### Pharmacy inventory & POS

Stock levels, reorder points, batch and expiry tracking, supplier records, over-the-counter sales.

**Hooks in the MVP:** `DispenseItem` already records what was actually dispensed at what price, which is the transactional spine inventory needs. Stock is currently the pharmacist looking at a shelf; an inventory module subtracts from a ledger instead, without changing the dispensing flow.

**Reality check:** incumbents do this well (§C). We build it because our clinics ask, not to win deals on it.

### Laboratory request & result (§H6)

Clinician orders a test tied to a visit; it routes to the clinic's own lab; results are entered by lab staff and attached to the record; the patient is notified results are ready.

**Non-negotiable:** results are shown in-app under consent, **never sent by SMS** (§H6.2) — the content rule in [Notifications](notifications-sms-whatsapp.md). Critical values are flagged for urgent clinician callback.

**Hooks:** `Consultation` accommodates ordered investigations. External lab integration stays deferred until demand is proven (§H6.3).

### EFRIS fiscal receipting

URA electronic fiscal receipting on the clinic's own TIN, using the clinic's own EFRIS credentials — the same non-custodial pattern as payments. Carevelo submits on the clinic's behalf; the tax obligation is the clinic's.

**Hooks:** `PaymentIntent` and receipt generation are already separable, so fiscalisation slots in as an additional step rather than a rewrite.

### Recurring refill subscriptions

Chronic patients on repeat medication. Requires clinician re-authorisation on a schedule — an unattended repeat prescription is exactly the sort of automation that would start looking like clinical decision-making, so a clinician approves each cycle.

### Analytics dashboards

Consultation volume, revenue through the platform, no-show rates, delivery performance, repeat rates.

**Constraint:** aggregate and tenant-scoped only. No cross-tenant benchmarking without explicit, specific consent from every tenant involved — a clinic's operating numbers are commercially sensitive and its competitors are our other customers.

**Hooks:** the honest revenue view is already the retention-critical screen ([Personas](../00-overview/personas-and-actors.md)); this deepens it.

### Custom domains and live rider tracking

Custom domains: `clinic.co.ug` instead of the subdomain, with certificate provisioning. **Hook:** `Tenant.custom_domain` already exists and tenant resolution already handles a host-based lookup.

Rider GPS: milestone statuses suffice for now and cost far less.

## Phase 3 (months 18–36)

### Transaction-fee layer

**Gated on written Bank of Uganda no-objection.** The mechanism — aggregator-side sub-merchant split or separate monthly invoice — is designed and switched off ([H5](prd-h5-payments-non-custodial.md), [ADR-0003](../70-decisions/0003-non-custodial-payment-architecture.md)). Under no circumstances does enabling it involve Carevelo holding funds.

### Inter-clinic referral network

A clinic refers a patient to another clinic on the platform, with records following the patient.

**The hard part is not the feature; it is that it deliberately crosses the tenant isolation boundary** ([Multi-Tenancy](../30-architecture/multi-tenancy.md)). It requires: explicit per-referral patient consent, a scoped and time-boxed grant rather than a general one, complete audit on both sides, and revocability. Design it as an explicit, narrow, consent-bound export — never as a relaxation of row-level security. If the isolation model has to soften to accommodate it, the design is wrong.

### USSD access

Booking and status for non-smartphone patients — a genuinely large addressable group. A significant build: session-based menus, aggregator integration, no rich content. The content rule applies with full force, since USSD is even less private than SMS.

### NHIS / insurance claims

**Only if enacted with published claim formats** (§C, §J). The NHIS Bill passed Parliament in March 2021 and remains unassented and stalled. Private-insurer formats are fragmented.

**Hook:** keep `Service` and `PaymentIntent` modular enough that a payer other than the patient can be introduced without reshaping them. Build nothing further until real rules exist.

### Embedded finance

Clinic working capital, patient BNPL — the venture-scale thesis in §L, and the direction Helium Health's funding follows. Each requires its own regulatory analysis and probably its own licensed partner. Not a software feature; a different company.

## Explicitly not planned

From [Non-Goals](non-goals.md): lab machine integration, consultation recording, multi-country expansion, and every permanent exclusion. Those are not late phases. They are permanent.

## The hook discipline

Cheap now, expensive later. Worth the small effort during MVP:

1. **`tenant_id` on every row**, composite foreign keys throughout. Retrofitting this is a nightmare and a live isolation risk.
2. **Domain events for every significant transition** ([Ubiquitous Language](../20-domain/ubiquitous-language.md)). New features subscribe rather than modify.
3. **Money as integer minor units with explicit currency.** Never a float, even though UGX has no subunit in practice.
4. **Modular monolith boundaries** ([Backend](../30-architecture/backend-laravel.md)) so a module can be extracted later.
5. **Prescriptions and dispensing as separate aggregates.** This is what makes inventory addable without touching clinical records.
6. **FHIR-conformant field naming where it costs nothing** (§I) — MoH interoperability guidance is coming.
7. **Notification templates as data, not code**, so new channels are configuration.

And the counter-discipline, which matters more: **do not build the abstraction until the second case exists.** A generalised payment-provider interface written for one provider is a guess. Add the second provider, then generalise.
