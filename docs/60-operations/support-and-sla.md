# Support & SLA

> **Status:** Draft
> **Last reviewed:** 2026-08-13
> **Derives from:** Business Plan §F, §J.3, §M

**Local support is one of the four things we compete on** (§E) — against India-built EasyClinic with no local presence and enterprise-focused Helium Health. It is a genuine advantage and it is also the thing most likely to consume the founder entirely (§J.3).

The tension is resolved by being honest about what we offer rather than promising availability we cannot sustain. **Promise less and deliver it.** A clinic that knows we answer within four hours during clinic hours is better served than one told "24/7" that discovers otherwise at 8pm.

## Channels

Ranked by how clinics actually behave, not by how we would prefer them to.

| Channel | Use |
|---|---|
| **WhatsApp** | Primary. This is how Ugandan small businesses communicate. Fighting it loses |
| Phone | Urgent, during clinic hours |
| In-app | Non-urgent, with context attached automatically |
| Email | Formal matters, records |

Support is per-clinic, not per-user. A five-person clinic has one relationship with us.

## Hours

| Tier | Hours | First response |
|---|---|---|
| Starter | Mon–Fri 08:00–18:00 EAT | 8 working hours |
| Clinic | Mon–Sat 08:00–18:00 EAT | 4 working hours |
| Polyclinic | Mon–Sat 08:00–20:00 EAT | 2 working hours |
| **Critical, any tier** | Any time | Best effort, target 1 hour |

Tiers per §F.

**Critical is deliberately narrow** — the platform is down, payments are failing across the board, or clinical data is at risk. A clinic cannot book an appointment at 21:00 on Sunday is not critical; it waits until Monday.

Be honest that out-of-hours is best effort. With one person on call (§M), pretending otherwise is a promise that will be broken at the worst moment.

## Severity

| Severity | Definition | Target resolution |
|---|---|---|
| **S1 — Critical** | Platform down; payments failing platform-wide; suspected data exposure | Immediate; updates every hour |
| **S2 — High** | One clinic cannot work; consultations failing; payments failing for one tenant | Same working day |
| **S3 — Medium** | A feature is broken with a workaround | 3 working days |
| **S4 — Low** | Cosmetic, question, feature request | 10 working days or triaged to backlog |

**This is the support-ticket scale, one of three.** It is distinct from the SEV security scale and the alert severities — see the reconciliation table in [Incident Response](../50-security-compliance/incident-response.md).

**The moment personal data may have been exposed, this scale stops governing** and [Incident Response](../50-security-compliance/incident-response.md) takes over, regardless of the ticket's original severity. An S3 ticket describing "a patient saw someone else's name" is a SEV-1.

**Clinical urgency escalates severity.** A clinician who cannot complete a consultation with a patient waiting is S2 whatever the underlying cause. The patient is in the room.

## What support may and may not see

The constraint that shapes every support interaction: each clinic is the **data controller**; we are the **processor** ([Data Protection](../50-security-compliance/data-protection-dppa.md)).

**Ordinary support tooling exposes no clinical data.** Diagnosis works from identifiers, states, audit metadata and error traces.

Ask the clinic for the **reference** — `APT-2608-0147`, `RX-2608-0092`. That is what the human references are for ([Identifiers](../20-domain/identifiers-and-numbering.md)): a clinic can describe a problem precisely without either party quoting patient data over WhatsApp.

Where clinical data genuinely must be examined, use **break-glass** ([RBAC Matrix](../50-security-compliance/rbac-matrix.md)): reason recorded, time-boxed, **tenant notified**, audited. It is not a convenience, and a rising count means the support tooling needs work, not that access is needed ([Observability](../30-architecture/observability.md)).

**Never ask a clinic to send patient data over WhatsApp.** It is an unencrypted-at-rest channel outside our control, and asking normalises exactly the behaviour we tell them to avoid.

## Common requests

| Request | Handling |
|---|---|
| "Did this payment go through?" | Reconciliation view. Give them the aggregator reference to check on **their own** dashboard — we cannot see their balance |
| "How do I refund?" | **Through their own aggregator.** We hold no funds. Explain plainly; it is not a limitation to apologise for ([Payments Regulatory Boundary](../50-security-compliance/payments-regulatory-boundary.md)) |
| "We deleted something" | Soft-delete recovery where available; otherwise a scoped restore ([Disaster Recovery](../30-architecture/disaster-recovery.md)). **Never restore the whole database for one tenant's mistake** |
| "A patient wants their data" | They are the controller. Their export tooling; we assist |
| "Add this feature" | Against [Non-Goals](../10-product/non-goals.md) first. If permanently excluded, explain the legal reason and what the clinic can do itself |
| "Our video keeps dropping" | Check mode step-downs; confirm voice and chat fallback is understood. Often a connectivity expectation, not a defect |
| "Prescription won't issue" | Almost always a missing registration number or `can_prescribe` ([Domain Model](../20-domain/domain-model.md)) |

## Status page

Public, updated within 15 minutes of detecting an incident — **before the cause is known.** A clinic owner deserves to know whether the problem is ours before telephoning us, and "we are investigating" is genuinely useful information.

Scheduled maintenance announced 48 hours ahead, outside Ugandan clinic hours.

## Scaling support

§K: first support hire at roughly **UGX 20m/month MRR**. Until then it is the founder, and the only defence is reducing the need.

| Lever | Effect |
|---|---|
| Fix the top three ticket causes each month | Compounds. Directly addresses §J.3 |
| Self-service help in-app, with context | Deflects S4 entirely |
| A one-page cheat sheet per role, printed | Clinics pin these up. Disproportionately effective |
| Track which onboarding steps need a human | Those steps are the product backlog |
| Aggressive alerting on the things clinics notice | Fix it before they call |

**The measure is tickets per clinic per month, and it must fall as clinics are added.** If it holds flat, the business cannot scale past the founder's hours — which §M identifies as the way this fails.

## What we do not offer

Stated so expectations are set at the sale, not discovered later:

- 24/7 guaranteed response. Best effort out of hours.
- On-site support as standard. Available for Kampala at a fee.
- Data entry or record migration as standard. A paid onboarding service (§F).
- Support for the clinic's own hardware, internet or devices.
- Clinical advice of any kind. **Ever.** We are a software supplier ([Non-Goals](../10-product/non-goals.md)).
