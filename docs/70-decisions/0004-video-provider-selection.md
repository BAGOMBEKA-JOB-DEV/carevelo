# ADR-0004 — Consultation video transport

> **Status:** Proposed — open decision
> **Date:** 2026-08-13
> **Derives from:** Business Plan §H3, §I, §M

## Context

Teleconsultation is the capability clinics are buying (§E). It must work for a patient on a mid-range Android phone over variable Ugandan mobile data, in a browser, with no app install.

Two pressures pull in opposite directions.

**Data residency.** DPPA 2019 restricts cross-border transfer without adequate safeguards; §I recommends in-country or in-region hosting, and §E lists Ugandan data residency as one of four things we compete on. Consultation media is health data by context — faces, voices, and the fact of a consultation.

**Founder capacity.** §M and §J.3 name this a top-three risk. Real-time media infrastructure is specialised operational work, and the alternative use of those weeks is talking to clinic owners — which §M says is what actually determines whether the business survives.

Mitigating both: **consultations are not recorded** ([Non-Goals](../10-product/non-goals.md)). There is no store of consultation media to breach — only ephemeral streams. That materially limits the residency exposure and is the fact that makes this decision tractable.

## Options considered

### A. Self-hosted Jitsi Meet

**For:** media stays in our chosen region — full residency control and the strongest version of the §E sales claim. **No per-minute cost**, so the marginal consultation is free, which matters enormously at UGX 150,000/month pricing. Open source, mature, browser-based, configurable to audio-only.

**Against:** we operate real-time media infrastructure — TURN servers, bandwidth, scaling, and debugging one clinician's failing call at 9am with no operations engineer. Quality on poor networks depends on our own tuning, which is genuinely specialised. This spends the scarcest resource directly.

### B. Managed provider — Daily, Agora, Twilio, Vonage

**For:** reliability on poor networks is their core competence, and they are measurably better at it than a first self-hosted deployment. Adaptive bitrate, global TURN, no operational burden. Working consultations in days rather than weeks.

**Against:** per-minute cost growing with success and hard to pass through at our price point. Media traverses infrastructure outside Uganda — a cross-border transfer requiring safeguards, a processing agreement and disclosure. A dependency we cannot fix when it breaks.

### C. Hybrid — managed first, self-hosted if triggered

Start managed behind an internal `ConsultationTransport` interface. Move to self-hosted when a defined trigger fires.

## Decision — proposed

**Option C, starting with a managed provider**, subject to two conditions:

1. A signed data-processing agreement, with the cross-border transfer disclosed in the patient consent text ([H2](../10-product/prd-h2-patient-registration-consent.md)).
2. Provider selected with an African or nearest-available region, and **performance on East African mobile networks tested rather than assumed.**

The reasoning is about Phase 1's actual risk. The binding constraint is proving clinics will pay (§M), not achieving perfect residency for transient, unrecorded media. Spending scarce founder weeks on media infrastructure before a single clinic has paid is the wrong trade — and if no clinic pays, the infrastructure was wasted entirely.

The interface boundary keeps the decision reversible, which is what makes starting with the pragmatic option defensible rather than merely convenient.

**Status is Proposed rather than Accepted**: the specific provider is not yet selected, and the network testing has not been done. This ADR moves to Accepted when a provider is chosen with measurements attached.

## Consequences

**Accepted costs.** A per-minute cost that scales with success. A cross-border transfer to disclose and paper. A dependency outside our control. A residency claim that is weaker than "everything stays in Uganda" and must be stated honestly rather than glossed.

**Benefits.** Working teleconsultation in days. Reliability on poor networks handled by people who specialise in it. Founder weeks preserved for the activity §M says determines survival.

**Forecloses.** Nothing permanently — the interface boundary is the point.

## Revisit when

Either trigger fires:

1. **Monthly media cost exceeds roughly 10% of MRR.** At that point self-hosting pays for the operational burden.
2. **MoH telemedicine regulations impose residency requirements on consultation media** (§J.4). Regulations are being drafted now, so this is foreseeable rather than hypothetical.

Also revisit if the provider's reliability on Ugandan networks proves materially worse than the self-hosted alternative — measure `technical_failure` outcomes and mode step-downs ([Observability](../30-architecture/observability.md)), which we instrument precisely so this can be judged on evidence.

## Related

[Realtime & Video](../30-architecture/realtime-and-video.md) · [H3](../10-product/prd-h3-teleconsultation.md) · [Data Residency](../30-architecture/data-residency-and-hosting.md) · [Integrations](../30-architecture/integrations.md)
