# Roadmap

> **Status:** Draft
> **Last reviewed:** 2026-08-13
> **Derives from:** Business Plan §K, §F, §G

Every phase carries an explicit **go** criterion and an explicit **kill** criterion. The kill criteria are the point of this document. A roadmap without them is a wish list.

## Phase 0 — Validation (months 0–1.5)

**No code.** Interview 25–30 clinic owners across Kampala, Wakiso and Mukono. Confirm the teleconsultation + mobile-money + delivery pain is real, learn what they currently use, and establish price sensitivity.

- **Go:** at least 3 clinics commit to a pilot, and at least 10 express willingness to pay ≥ UGX 150,000/month.
- **Kill:** fewer than 2 willing to pilot, or the price ceiling sits below hosting-plus-support break-even.

Documentation is the correct parallel activity here — it costs nothing to discard and it sharpens the demo conversation.

## Phase 1 — MVP (months 1.5–6)

Build flows [H1](../10-product/prd-h1-clinic-onboarding.md) through [H5](../10-product/prd-h5-payments-non-custodial.md). Register with the PDPO. Deploy to design partners free of charge in exchange for testimonials and referrals.

- **Go:** onboarding completes in under one day; ≥ 3 clinics running weekly teleconsultations; ≥ 1 paying by month 6.
- **Kill:** no clinic will pay after the pilot.

**Compliance gates that must close inside this phase, before any real patient data exists:**

- PDPO registration complete, Data Protection Officer named.
- Tenant isolation verified by test, per [Test Strategy](../80-quality/test-strategy.md).
- Data processing agreement signed with each design-partner clinic.
- Hosting in a jurisdiction meeting [Data Residency](../30-architecture/data-residency-and-hosting.md).

## Phase 2 — Paid beachhead and scale (months 6–18)

Referral engine, delivery-dispatch polish, SMS margin, EFRIS receipting, pharmacy inventory, lab request/result. Target **UGX 10m/month recurring**, roughly 33 clinics at a blended ARPU of UGX 300,000.

- **Go:** MRR growth ≥ 15%/month; churn < 5%/month.
- **Kill:** churn sustained above 10%/month, or post-pilot conversion below 30% — at which point stop and re-price or re-scope rather than pushing harder.

## Phase 3 — Depth and optional pivot (months 18–36)

Analytics, inter-clinic referrals, USSD access for non-smartphone patients. Test the transaction-fee layer — **only after written Bank of Uganda no-objection** ([ADR-0003](../70-decisions/0003-non-custodial-payment-architecture.md)). First support hire at roughly UGX 20m/month MRR. Target **UGX 50m/month**.

- **Venture gate:** ≥ 150 active clinics *and* measurable payment/prescription flow through the platform. Only then does raising capital make sense; the subscription business alone caps out in the low single-digit billions of UGX per year and is a strong bootstrapped business rather than a venture one (§L).
- **Otherwise:** continue as a high-margin bootstrapped business. This is a perfectly good outcome and should not be treated as failure.

## Signals that change the plan

From §M and the risk register (§J). These are worth re-reading quarterly.

| Signal | Response |
|---|---|
| MoH enacts telemedicine regulations imposing obligations on software vendors | Re-assign obligations to the clinic where the law permits; otherwise add the mandated controls. The architecture already keeps the clinical act on the clinic's clinician, which is the best available hedge |
| Bank of Uganda declines the no-objection | Transaction fees never switch on. Subscription-only. The architecture does not change, because it was never custodial |
| A funded incumbent launches a comparable non-custodial white-label bundle | Accelerate beachhead density and switching-cost lock-in, or seek capital |
| NHIS is assented and claim formats published | Reassess Phase 3 claims module against real published rules — not before |
| Post-pilot conversion < 30% or churn > 10% | Stop feature work. Re-price or re-scope |

## What is deliberately not on this roadmap

Enumerated in [Non-Goals](../10-product/non-goals.md). In short: anything that would make Carevelo a healthcare provider, a drug handler or a payment service provider. Those are not future phases. They are permanent exclusions.
