# Compliance Responsibility Matrix

> **Status:** Draft
> **Last reviewed:** 2026-08-13
> **Derives from:** Business Plan §I

Who owns each obligation, and — where it is ours — the document and mechanism that enforces it. The **Enforced by** column is what turns this from a table of intentions into an auditable claim.

## The matrix

| Obligation / licence | Responsible party | Enforced by | Notes |
|---|---|---|---|
| **Clinic / health-unit licence** (UMDPC) | **Clinic** | [H1](../10-product/prd-h1-clinic-onboarding.md) — reference recorded as an **unverified attestation** | Carevelo never operates a facility. It has no access to the register and never implies verification |
| **Clinician registration + Annual Practising Licence** (UMDPC / AHPC / Nurses & Midwives Council) | **Clinic / clinician** | [Domain Model](../20-domain/domain-model.md) — prescribing requires `can_prescribe` + a registration number | The remote consultation is the clinician's clinical act. The platform is a tool |
| **NDA pharmacy / drug-shop licence + dispensing** | **Clinic pharmacy** | [H4](../10-product/prd-h4-prescription-dispensing-delivery.md) — dispensing recorded against a named tenant pharmacist; **controlled items excluded from delivery** | Only the licensed pharmacy dispenses. **Carevelo never holds or dispenses drugs.** Controlled substances per NDPA Act Cap 206 |
| **Remote prescribing legality** | **Clinician**, under existing law | [H3](../10-product/prd-h3-teleconsultation.md) — clinician identity snapshotted onto the prescription; Carevelo never appears as issuer | **No enacted telemedicine law in Uganda.** Monitor MoH's forthcoming regulations and adapt (§J.4) |
| **PDPO registration** (DPPA 2019) | **Platform** (processor) **and each clinic** (controller) | [Data Protection](data-protection-dppa.md) — Phase 1 gate; named DPO | UGX 100,000; Form 2 + Form 3 commissioned; health data is special-category |
| **Consent capture and evidence** | **Clinic** (controller); platform provides the mechanism | [H2](../10-product/prd-h2-patient-registration-consent.md), [Audit Logging](audit-logging.md) — immutable `ConsentRecord` with policy version and text hash | Consent must be *demonstrable*. That is what the hash is for |
| **Data-subject requests** | **Clinic** (controller) | [Retention & Deletion](data-retention-and-deletion.md) — platform tooling | We provide the tools; the clinic answers |
| **Medical-record retention** | **Clinic** (controller) | [Retention & Deletion](data-retention-and-deletion.md) — configurable per tenant | The erasure-versus-retention conflict is the clinic's to resolve; we must not obscure it |
| **Cross-border transfer / localisation** | **Platform** | [Data Residency](../30-architecture/data-residency-and-hosting.md) — in-region persistence; enumerated exceptions carry no clinical content | DPPA restricts transfer without safeguards. Google precedent, July 2025 |
| **Tenant isolation** | **Platform** | [Multi-Tenancy](../30-architecture/multi-tenancy.md) — **PostgreSQL RLS**; per-model isolation tests block release | Each clinic is a separate controller. A leak breaches two at once |
| **Breach notification** | **Clinic** (controller) to PDPO and patients; **platform** must notify the clinic | [Incident Response](incident-response.md) — clinics notified within hours | They cannot discharge their duty if we have not told them |
| **Payment collection** (NPS Act 2020) | **Aggregator** (Flutterwave PSO / Pesapal PSO) | [Payments Regulatory Boundary](payments-regulatory-boundary.md) — **non-custodial**; CI check on forbidden identifiers | **Carevelo never takes custody of funds.** Before any platform transaction fee, obtain **written BoU no-objection** — the PSO definitions are activity-based, not custody-based |
| **PCI DSS** | **Aggregator** | [Integrations](../30-architecture/integrations.md) — card data never reaches us; 3DS entirely at the aggregator | Scope stays with the licensed party |
| **Tax / fiscal receipting (EFRIS)** | **Clinic** | Phase 2, on the clinic's own TIN and credentials | Same non-custodial pattern as payments |
| **Advertising of health services** | **Clinic** | [White-Labeling](../10-product/white-labeling-and-branding.md), [Non-Goals](../10-product/non-goals.md) | UMDPC restricts provider advertising. **Carevelo markets software to clinics, never care to patients** |
| **Health-information-system certification** (NITA-U) | Monitor | [Phase 2 & 3](../10-product/phase-2-3-outline.md) — FHIR-ready naming where free | No clear published mandate today; MoH digital-health guidelines may introduce standards |
| **NHIS claims** | Defer | [Non-Goals](../10-product/non-goals.md) | Bill unassented and stalled. Build only on published rules |
| **Employment of clinical staff** | **Clinic** | [Domain Model](../20-domain/domain-model.md) — no platform-level clinician exists | **Carevelo never employs or contracts clinicians** |

## The three permanent boundaries

Restated here because this is the table an auditor reads, and each appears above distributed across several rows. Full statements in [Non-Goals](../10-product/non-goals.md) and [Vision & Scope](../00-overview/vision-and-scope.md).

| Boundary | Regulatory consequence avoided | Enforced by |
|---|---|---|
| **Never employs or contracts clinicians** | UMDPC provider licensing; professional liability for clinical outcomes | [Domain Model](../20-domain/domain-model.md), [RBAC Matrix](rbac-matrix.md) |
| **Never holds or dispenses drugs** | NDA licensing; NDPA Act Cap 206 obligations | [H4](../10-product/prd-h4-prescription-dispensing-delivery.md), [Domain Model](../20-domain/domain-model.md) |
| **Never takes custody of patient funds** | NPS Act 2020 PSP / e-money issuer licensing (UGX 250m–10bn capital) | [Payments Regulatory Boundary](payments-regulatory-boundary.md), [ADR-0003](../70-decisions/0003-non-custodial-payment-architecture.md) |

## Controller and processor, in one line

**Each clinic is the data controller. Carevelo is the processor.** This single distinction determines who answers a data-subject request, who notifies the PDPO of a breach, who decides retention, and who must receive an export on offboarding. It is documented in [Data Protection](data-protection-dppa.md) and contracted in the data processing agreement signed during onboarding.

## Open regulatory items

Tracked, and each carries a defined response.

| Item | Status | Response |
|---|---|---|
| **MoH telemedicine regulations** | Being drafted; **none enacted** | Keep the clinical act on the clinic's clinician — the best available hedge. Engage via UHF. Architect to add mandated controls |
| **BoU no-objection for a platform fee** | Not sought | Required before any percentage fee. Subscription-only until then. Declining changes nothing architectural |
| **NPS Regulations amended 2022** | Cited figures derive from 2021 guidance | Re-verify all capital and fee figures against the current amended regulations before relying on them (§ Caveats) |
| **NHIS enactment** | Bill passed 2021, unassented, stalled | Build nothing until enacted with published claim formats |
| **NITA-U / MoH HIS standards** | No published mandate for private providers | Monitor; design FHIR-ready where it is free |
| **PDPO enforcement practice** | Developing; Google finding July 2025 | Register early, appoint a DPO, keep data in region |

## Review

This matrix is reviewed **quarterly** and on any of these triggers:

- MoH publishes telemedicine or digital-health regulations.
- The Bank of Uganda responds on the no-objection.
- NHIS is assented.
- A new integration or feature touches a regulated activity.
- Any incident with a regulatory dimension.

A change here is a change to what the platform legally is. It goes through an ADR, not a silent edit.
