# ADR-0004 — Consultation video transport

> **Status:** Accepted — with an explicit blocker (see [Status](#status))
> **Date:** 2026-08-13 · **Decided:** 2026-08-26
> **Derives from:** Business Plan §H3, §I, §M

## Context

Teleconsultation is the capability clinics are buying (§E). It must work for a patient on a mid-range Android phone over variable Ugandan mobile data, in a browser, with no app install.

Two pressures pull in opposite directions.

**Data residency.** DPPA 2019 restricts cross-border transfer without adequate safeguards; §I recommends in-country or in-region hosting, and §E lists Ugandan data residency as one of four things we compete on. Consultation media is health data by context — faces, voices, and the fact of a consultation.

**Founder capacity.** §M and §J.3 name this a top-three risk. Real-time media infrastructure is specialised operational work, and the alternative use of those weeks is talking to clinic owners — which §M says is what actually determines whether the business survives.

Mitigating both: **consultations are not recorded** ([Non-Goals](../10-product/non-goals.md)). There is no store of consultation media to breach — only ephemeral streams. That materially limits the residency exposure and is the fact that makes this decision tractable.

## Options considered

### A. Self-hosted open-source SFU

Written up originally as Jitsi Meet. The software finally chosen is **LiveKit**, which is the same option in every respect that mattered to this decision — Apache-2.0, browser-based with no install, no per-minute cost, run on our own hardware — and better in two that did not come up: its client SDKs and server API are identical whether it runs on our box or on LiveKit Cloud, so the option stays reversible in both directions, and `backend/app/Support/Video/` had already been written against it.

**For:** media stays in our chosen region — full residency control and the strongest version of the §E sales claim. **No per-minute cost**, so the marginal consultation is free, which matters enormously at UGX 150,000/month pricing. Open source, mature, browser-based, configurable to audio-only.

**Against:** we operate real-time media infrastructure — TURN servers, bandwidth, scaling, and debugging one clinician's failing call at 9am with no operations engineer. Quality on poor networks depends on our own tuning, which is genuinely specialised. This spends the scarcest resource directly.

### B. Managed provider — Daily, Agora, Twilio, Vonage, LiveKit Cloud

**For:** reliability on poor networks is their core competence, and they are measurably better at it than a first self-hosted deployment. Adaptive bitrate, global TURN, no operational burden. Working consultations in days rather than weeks.

**Against:** per-minute cost growing with success and hard to pass through at our price point. Media traverses infrastructure outside Uganda — a cross-border transfer requiring safeguards, a processing agreement and disclosure. A dependency we cannot fix when it breaks.

### C. Hybrid — managed first, self-hosted if triggered

Start managed behind an internal transport interface. Move to self-hosted when a defined trigger fires.

## Decision

**Option A: LiveKit, self-hosted on infrastructure we operate.** Decided on cost.

This overrides the Option C proposed above, on the owner's call. The reasoning that produced Option C — that founder weeks are scarcer than money in Phase 1 — is not wrong, and it is not what was weighed. What was weighed is that the media bill lands inside a subscription price that is already set.

### The arithmetic

A Starter clinic pays **UGX 150,000/month, about $40** (Business Plan §F), and teleconsult is listed as *included*. That is the whole revenue line the media cost has to come out of, alongside everything else the platform does for that clinic.

A twenty-minute consultation with two participants is **40 participant-minutes**. Two hundred consultations a month — a busy Phase 1 clinic — is **8,000 participant-minutes**:

| Transport | Rate (per participant-minute) | Monthly, at 200 consultations | Share of a $40 subscription |
|---|---|---|---|
| LiveKit Cloud | ~$0.0005 | **$4** | 10% |
| Daily | ~$0.004 | **$32** | 80% |
| Twilio | ~$0.015 | **$120** | 300% |
| **Self-hosted LiveKit** | **$0** | **$0 marginal** | — |

Twilio at this volume costs three times the subscription. Daily consumes four fifths of it, on a plan that still has to pay for hosting, SMS, support and everything else. Even LiveKit Cloud — much the cheapest managed option — takes a tenth of the price of the product, and every one of these numbers *grows with success*: the better teleconsultation works, the more of the subscription it eats.

Self-hosted, the marginal consultation costs **nothing**. The bill becomes a fixed VPS — roughly $12–25/month for the whole platform, not per clinic — and it stops tracking usage.

That is the decision. It is not that self-hosting is cheap; it is that a per-minute cost inside a fixed subscription price is a structural problem and a fixed server bill is not.

### What is accepted in exchange

The "Against" written for Option A above is now the cost being accepted, and it is repeated rather than dropped:

> we operate real-time media infrastructure — TURN servers, bandwidth, scaling, and debugging one clinician's failing call at 9am with no operations engineer.

Specifically:

- **A media server and a TURN relay to operate.** Not one component but two, and the second is the one that breaks. Ugandan mobile carriers put subscribers behind carrier-grade NAT, so a large share of patients have no address the SFU can reach and their media must be relayed. TURN is the main path here, not a fallback.
- **TURN bandwidth on our meter.** Relayed media crosses our box twice. At 200 consultations a month that is around 110 GB — small, and it is a number that grows the same way the per-minute bill would have, just far more slowly and from a much lower base.
- **Call quality is our tuning.** Bitrate behaviour on a degrading 3G connection is what a managed provider employs specialists for. We have a config file and a README.
- **Nobody is on call.** A consultation failing at 9am on a Tuesday is the founder reading logs while the clinic watches. No support contract, no escalation.
- **Certificate renewal is not fully automatic.** coturn does not reload certificates, so it needs a scheduled restart — a chore that, forgotten, breaks TLS relay for exactly the patients who needed the relay.

This is not free. It converts a variable cost into a fixed one and buys the difference with operational work, which is the resource §M says is scarcest.

### What self-hosting buys beyond the money

**Media never leaves the region we choose.** That is the strongest available version of the residency position: not "transferred with safeguards" but "not transferred". Under the DPPA 2019 it removes the cross-border transfer from the analysis rather than papering it, and it removes the corresponding sentence from the [H2](../10-product/prd-h2-patient-registration-consent.md) consent text entirely — there is no third-party processor to name and no transfer to disclose, because a patient's consultation reaches a server we run and stops there.

Combined with the standing no-recording rule, the residency story becomes short enough to be verifiable: media is ephemeral, unrecorded, and never leaves our infrastructure.

It also removes a dependency we could not have fixed when it broke, and it forecloses nothing — the interface boundary and the identical SDKs mean moving to LiveKit Cloud later is a URL and a key pair.

## Status

**Accepted**, with one blocker named explicitly:

> **East African mobile network performance has not been measured, and must be before the first production consultation.**

This was a condition of the proposed Option C and it survives the change of decision unchanged in substance and *strengthened* in importance. Under a managed provider the measurement would have been a procurement question: pick the provider that measures best. Self-hosted, it is an engineering question with no vendor behind it — the region, the relay's placement, and the bitrate behaviour on a bad connection are all now ours to get right, and there is nobody to escalate a bad result to.

What has to be measured, from real Ugandan mobile connections on more than one carrier:

1. Round-trip time and packet loss to each candidate region. Intuition says Johannesburg or Nairobi; Uganda's international transit runs east to the Mombasa landings and on to Europe, so a Frankfurt box may measure better than a Johannesburg one for some ISPs. This is exactly the kind of thing that must be measured rather than assumed.
2. Whether calls connect **at all** on MTN and Airtel mobile data, with wifi off, on two separate handsets — the configuration that exercises the TURN relay. Two tabs on one laptop prove nothing.
3. What the call does as the connection degrades, since the step-down to voice and then chat is a product requirement ([H3](../10-product/prd-h3-teleconsultation.md)) and not an accident.

Instrumentation for the ongoing version of this already exists: `technical_failure` outcomes and mode step-downs ([Observability](../30-architecture/observability.md)) are recorded precisely so this is judged on evidence rather than on impressions.

## Consequences

**Accepted costs.** Real-time media infrastructure to operate, including a mandatory TURN relay. A fixed monthly server bill whether or not consultations happen. Bandwidth we pay for. Call quality dependent on our own tuning. No operations engineer, and no support contract, when a call fails at 9am.

**Benefits.** Zero marginal cost per consultation, so teleconsultation cannot eat the subscription it is sold inside. Media stays in our chosen region — the strong form of the DPPA-2019 residency position, and no cross-border transfer to disclose in the H2 consent text. No dependency outside our control.

**Forecloses.** Nothing permanently. LiveKit Cloud and a self-hosted LiveKit are the same SFU, the same SDKs and the same API, so reversing this is a URL and a key pair — which is also what made adopting it cheap.

## Revisit when

1. **Operating this proves to be the wrong use of founder weeks.** The original argument for Option C was capacity, not cost, and it was not refuted — it was outweighed. If media operations start displacing the clinic conversations §M says determine survival, LiveKit Cloud is $4/month at current volume and the migration is a configuration change.
2. **Volume grows past a single node.** Multi-node LiveKit needs Redis and a real operations story. That is the point to re-run the arithmetic above with the managed option, because the numbers move.
3. **MoH telemedicine regulations impose requirements this deployment cannot meet** (§J.4). Regulations are being drafted now. Self-hosting satisfies residency, but not necessarily whatever else arrives.

## Related

[Realtime & Video](../30-architecture/realtime-and-video.md) · [H3](../10-product/prd-h3-teleconsultation.md) · [Data Residency](../30-architecture/data-residency-and-hosting.md) · [Integrations](../30-architecture/integrations.md) · `deploy/livekit/README.md` — the deployment, and what it honestly costs to run
