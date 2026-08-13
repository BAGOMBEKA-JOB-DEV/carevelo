# Non-Goals

> **Status:** Draft
> **Last reviewed:** 2026-08-13
> **Derives from:** Business Plan §C, §I, §M

Two categories, and the difference matters. **Permanent exclusions** would change what Carevelo legally is; they are never revisited. **Deferrals** are timing decisions and appear in [Phase 2 & 3 Outline](phase-2-3-outline.md).

---

## Permanent exclusions

Each of these keeps Carevelo a software supplier and data processor. Crossing any one moves it into a regulated category with capital requirements, licensing and liability that a small software business cannot carry — and that would destroy the "arms dealer, not combatant" logic the whole plan rests on (§A).

They are repeated in [Vision & Scope](../00-overview/vision-and-scope.md), in the architecture documents that enforce them, and in the [Compliance Responsibility Matrix](../50-security-compliance/compliance-responsibility-matrix.md). Repetition is deliberate: a constraint stated in only one place is not a constraint.

### 1. Carevelo never employs or contracts clinicians

**Why:** employing clinicians makes Carevelo a healthcare provider, subject to UMDPC facility licensing, professional liability for clinical outcomes, and the advertising restrictions that apply to providers.

**Not built:** platform-level clinician accounts; a Carevelo clinician marketplace; triage or advice given by Carevelo; any clinical decision support, differential suggestion, dosage or drug-interaction checking. Interaction checking deserves specific mention because it *sounds* like an obvious safety feature — but shipping it implies a duty of care we cannot discharge and a clinical-governance apparatus we do not have.

**Enforced by:** [Domain Model](../20-domain/domain-model.md) — `Clinician` exists only within a tenant; [RBAC Matrix](../50-security-compliance/rbac-matrix.md).

### 2. Carevelo never holds or dispenses drugs

**Why:** holding or dispensing requires NDA licensing under the NDPA Act Cap 206, licensed premises and licensed personnel.

**Not built:** platform-owned stock; a Carevelo pharmacy; a medicine marketplace; drug procurement; any margin on medicines. Delivery is dispatch and tracking only — Carevelo does not operate a fleet, because a fleet carrying pharmaceuticals is a regulated logistics operation.

**Enforced by:** [H4](prd-h4-prescription-dispensing-delivery.md) — dispensing is always recorded against a named pharmacist of the tenant; controlled items never enter the delivery flow.

### 3. Carevelo never takes custody of patient funds

**Why:** custody triggers the NPS Act 2020 PSP or e-money-issuer categories, with capital requirements from UGX 250m to 10bn.

**Not built:** wallet, balance, float, escrow, hold-and-release, settlement account, platform-initiated refund, or any stored value. **These entities do not exist in the schema and their absence is a compliance control**, verified by an automated check against a forbidden-identifier list.

**Enforced by:** [Payments Regulatory Boundary](../50-security-compliance/payments-regulatory-boundary.md), [ADR-0003](../70-decisions/0003-non-custodial-payment-architecture.md).

### 4. Carevelo does not advertise health services

UMDPC restricts the advertising of health services. Carevelo markets **software to clinics**. Marketing material never promotes care, names conditions treated, or implies clinical outcomes. Patient-facing surfaces carry the clinic's brand and the clinic's claims, not ours ([White-Labeling](white-labeling-and-branding.md)).

### 5. Carevelo does not verify licences

We record UMDPC and NDA references as the clinic's own attestation. We have no access to those registers and will not imply verification we have not performed. Every surface displaying a reference says so.

The temptation here is real — "verified clinic" is a compelling badge. It would also be a lie, and one a patient might rely on.

### 6. Carevelo does not become the patient relationship

The patient belongs to the clinic. No Carevelo-branded patient app, no cross-clinic patient directory, no marketing to patients, no using one clinic's patient data to benefit another. Breaching this would destroy the trust the entire distribution model depends on — clinic owners are, correctly, alert to being disintermediated by their own software vendor.

There is deliberately **no cross-tenant patient identity** ([Ubiquitous Language](../20-domain/ubiquitous-language.md)).

---

## Deferrals

Not prohibited. Not now. Hooks are noted in [Phase 2 & 3 Outline](phase-2-3-outline.md).

| Deferred | Why | Phase |
|---|---|---|
| **Pharmacy inventory / ERP** | ClinicMaster and others do this well (§C). Competing head-on wastes the scarcest resource, founder time | 2 |
| **Laboratory request & result** | Real demand, but not what closes the first sale | 2 |
| **Lab machine integration, hardware** | Capital- and support-heavy | Not planned |
| **EFRIS fiscal receipting** | Well-specified and valuable; not a differentiator at 33 clinics | 2 |
| **Insurance / NHIS claims** | Bill unassented and stalled; private claim formats fragmented. Building against unpublished rules is speculation | 3, gated on enactment |
| **Full EMR breadth** | The contested field. We lead with the un-served bundle instead (§E) | Ongoing, as table stakes |
| **Custom domains** | Subdomains suffice initially | 2 |
| **Consultation recording** | Raises breach exposure and consent complexity for a benefit no clinic has requested | Not planned |
| **Live rider GPS tracking** | Status milestones are sufficient and much cheaper | 2 |
| **USSD access** | Reaches non-smartphone patients, but a large build | 3 |
| **Inter-clinic referral network** | Requires cross-tenant data sharing, which needs careful design against the isolation model | 3 |
| **Embedded finance (BNPL, clinic credit)** | The venture-scale direction in §L. Its own regulatory analysis required | 3+ |
| **Offline-first operation** | Genuinely valuable in this market and genuinely expensive. Revisit if connectivity proves a real churn driver | Under review |
| **Native mobile apps** | Web-first. Requiring an install loses patients at the moment they need care | Under review |
| **Multi-country expansion** | Uganda-specific regulation is baked deep. Deliberate, not accidental | Not planned |

## How to use this document

When someone proposes a feature, check it here first.

If it appears under **permanent exclusions**, the answer is no, and the reason is legal rather than a matter of prioritisation — no amount of customer demand changes it. If a clinic insists, the honest response is that the clinic can do that thing itself under its own licences, and we will support the workflow.

If it appears under **deferrals**, the answer is "not yet", and the question becomes which phase gate it belongs to.

If it appears nowhere, it is a genuine product decision. Weigh it against the §M constraint: **does it visibly help the clinic earn or retain revenue?** If not, it is not MVP.
