# Business Plan & Operational Flows: A White-Label Digital Health Platform for Uganda's Private Clinics

## TL;DR
- **The "arms dealer" thesis is viable but the whitespace is narrower than assumed:** no vendor currently sells a true, non-custodial, mobile-money-native white-label *teleconsultation + prescription + delivery* stack to independent Ugandan clinics, but well-entrenched clinic/hospital management software already exists (Kampala-based ClinicMaster, used in "over 180 hospitals and clinics in Zambia, Uganda, Kenya, South Sudan, and Rwanda"; locally-built Stre@mline; India-built EasyClinic actively marketing to Uganda; Nigeria's Helium Health already onboarding Ugandan facilities). The founder must therefore win on **workflow (teleconsult + mobile-money + delivery dispatch), price and local support**, not on "EMR" — that field is crowded.
- **This is a bootstrapped cash business first, not a venture deal — for now.** The addressable, willing-to-pay urban private-clinic base is in the low thousands (Uganda has ~3,856 private-for-profit facilities and 1,980 licensed retail pharmacies), out-of-pocket spending funds ~34–41% of health expenditure, and there is no incumbent white-label teleconsult layer. But at realistic SaaS prices the total market is a few billion UGX/year — enough for a strong solo lifestyle business, and only venture-scale if the platform captures a **transaction cut of payment/prescription flow** across hundreds of clinics.
- **Regulation is favourable to a software-only, non-custodial model but has two live risks:** (1) Uganda has **no enacted telemedicine law yet** — MoH is only now drafting telemedicine and AI regulations — so remote prescribing rests on the clinic's own licensed clinicians under existing UMDPC/NDA rules; (2) a non-custodial payment design (funds settle directly to the clinic's own MoMo/bank account via a Bank-of-Uganda-licensed aggregator such as Flutterwave or Pesapal) avoids the PSP/e-money licence, but the NPS Act 2020's "aggregator/integrator" definitions are activity-based, so a written no-objection from Bank of Uganda is prudent before charging any transaction fee.

## Key Findings

**1. Market sizing.** By end of FY2022/23 Uganda had 8,386 public and private health facilities; private-for-profit providers operated 46% (3,856), government 41% (3,448) and private-not-for-profit 13% (1,082) (World Bank data reported by The Independent, 2023). The 2018 National Health Facility Master List recorded 6,937 facilities. The National Drug Authority's licensed-outlets register (as at 8 June 2026) shows 3,595 registered pharmaceutical outlets, comprising 1,980 retail pharmacies, 1,134 wholesale pharmacies, 367 medical-device outlets and 114 external stores; licensed drug shops (Class C) are tracked on a separate register and number in the several thousands. The private sector accounts for ~47% of the health workforce, ~60% of clinical officers and ~80% of doctors (O'Hanlon et al., cited in Health Policy & Planning, 2020). Out-of-pocket payments funded ~34% of current health expenditure in FY2021/22 (UNICEF Uganda budget brief 2023/24; EPRC), and private expenditure was ~41% of CHE in 2019 (ThinkWell). Formal health-insurance coverage is ~1.1% of the population (National Population & Housing Census 2024).

**2. Competition — the whitespace claim partly survives.** Clinic/hospital management software is NOT a greenfield: **ClinicMaster** (Kampala, founded 2009 by Wilson Kutegeka) reports, on its own site, that its "software is currently used over 180 hospitals and clinics in Zambia, Uganda, Kenya, South Sudan, and Rwanda," serving "more than 20 million patients" with a team of ~20 full-time staff, and offering full EMR, pharmacy stock, lab, and insurance-claim modules; **Stre@mline** (istreams, south-western Uganda) is a locally-built offline EHR used on 60,000+ patients; **EasyClinic** (easyclinic.io, an India-built product referencing India's NDHM/Ayushman standards) is actively content-marketing telemedicine + EMR + mobile-money billing to Ugandan clinics; and **Helium Health** (Nigeria) has onboarded Ugandan facilities and is rolling out HeliumCredit there. Helium has raised US$42.12 million to date — a US$10m Series A (2020) and a US$30m Series B (June 2023, led by AXA IM Alts with Capria Ventures, Angaza Capital, Tencent, Global Ventures and Anne Wojcicki of 23andMe participating; per Techpoint Africa/Techloy). What is NOT visibly present is a **Ugandan-built, non-custodial, mobile-money-native white-label stack that bundles teleconsultation + e-prescription + the clinic's-own-pharmacy dispensing + delivery dispatch** for small independent clinics. That specific bundle — the "Rocket Health experience, but on the clinic's own licences and brand" — appears to be genuine whitespace.

**3. Regulation.** Uganda has **not yet enacted telemedicine legislation**; researchers note "Uganda has not yet developed laws and regulations on telemedicine" (Pan African Medical Journal), and MoH is currently drafting telemedicine and AI regulations plus EMR/interoperability/data-protection guidance (Daily Monitor, 2024). Rocket Health/The Medical Concierge Group (TMCG) operates lawfully today purely under existing UMDPC, Allied Health Professionals Council and NDA licensure of its clinicians and pharmacy — the same route a client clinic uses. Under the **Data Protection and Privacy Act 2019**, registration with the Personal Data Protection Office (PDPO) is mandatory for any data collector/processor/controller (fee UGX 100,000 ≈ USD 27; Form 2 + Form 3 commissioned by a Commissioner for Oaths); health data is special-category data; the Act has extraterritorial reach (Google was found in breach in July 2025 for failing to register). Under the **National Payment Systems Act 2020**, offering a payment service/operating a payment system requires a Bank of Uganda licence; a non-custodial design avoids the PSP/e-money-issuer category (the custody-triggered one, capital UGX 250M–10bn), and both **Flutterwave** ("granted a Payments System Operator (PSO) licence from the Bank of Uganda," announced 28 August 2024) and **Pesapal (PSO)** are licensed to collect on merchants' behalf. The **National Health Insurance Scheme** Bill was passed by Parliament in March 2021 but remains unassented and stalled as of 2025 (awaiting cabinet approval; proposed contribution UGX 15,000/month).

**4. Pricing & unit economics.** Payment aggregators charge roughly 3% (Flutterwave local) to 3.5% (Pesapal, commonly cited) on collections. Africa's Talking and other bulk-SMS providers operate in Uganda; alphanumeric sender-ID registration costs UGX 300,000 (MTN, monthly / Airtel, one-time). PDPO registration is UGX 100,000. These low fixed costs make a bootstrapped model feasible.

## Details — The Business Plan

### A. Executive Summary
The proposed venture supplies **white-label digital health software** — teleconsultation, patient records, e-prescribing, own-pharmacy dispensing, delivery dispatch and mobile-money collection — to Uganda's licensed private clinics, pharmacies and small hospitals, under each clinic's own brand and own regulatory licences. It deliberately does **not** provide clinical services, hold drugs, employ clinicians or take custody of patient funds. The strategic logic ("arms dealer, not combatant") is that a solo, zero-capital developer cannot and should not replicate Rocket Health's vertically-integrated infrastructure — Rocket Health "raised $5 million in its Series A round of funding, bringing its total funding to $6.2 million" (round led by Creadev with Grenfell Holdings and LoftyInc, March 2022; The Kenyan Wallstreet). Instead the plan arms the hundreds of clinics that already hold NDA pharmacy licences, premises and UMDPC-registered clinicians but are losing walk-in and repeat patients to Rocket Health's convenience.

The founder's edge is real and specific: deep multi-tenant SaaS, PostgreSQL, EFRIS/URA, NIRA and mobile-money integration experience, plus an existing ICT consultancy that provides credibility, an invoicing entity and a support base — assets a typical health-tech founder lacks. The plan is a bootstrapped cash business targeting UGX 10m/month within ~12 months and UGX 50m/month within ~24–30 months, with an optional later pivot to venture scale by capturing a transaction margin on payment and prescription flow across many clinics.

### B. Problem and Opportunity
Uganda's private-for-profit sector runs ~3,856 facilities and serves the majority of care-seeking (private providers account for ~80% of doctors and ~60% of clinical officers), overwhelmingly financed out-of-pocket (~34% of CHE, ~UGX 2.3 trillion in FY2020/21). These clinics face a convenience gap: Rocket Health (founded 2012 by Dr Davis Musinguzi) offers "over 25,000 individual patients" four integrated services — "24/7 teleconsultations, medicine delivery, home sample collection for laboratory diagnostic testing and physical specialist clinic consultations" (Disrupt Africa, 2022) — pulling patients away from neighbourhood clinics that have the licences and physical trust but no digital front door. Most small clinics keep paper records, collect cash or ad-hoc MoMo with no reconciliation, and cannot offer teleconsultation, online refills or delivery. The opportunity is to give them Rocket-Health-like capability on their own brand, cheaply, without capital outlay.

### C. The Solution and Product Scope

**MVP (smallest thing a clinic will pay for) — "Digital Front Door + Money":**
1. **Branded booking + teleconsultation** (video/voice/secure chat) tied to the clinic's own clinicians.
2. **Lightweight patient record + visit notes + e-prescription** (PDF issued under the clinician's name/registration number).
3. **Mobile-money & card collection, non-custodial** — funds settle directly to the clinic's own MTN MoMo/Airtel/bank account via Flutterwave/Pesapal; the platform never touches funds.
4. **Prescription-to-own-pharmacy handoff + simple delivery dispatch** (assign a rider, share status).
5. **Multi-tenant admin**: clinic administrator manages staff, services, prices, working hours.
6. **SMS/WhatsApp notifications** for appointments, payment confirmation and prescription-ready.

**Phase 2:** pharmacy inventory & POS, lab request/result return, recurring-refill subscriptions, EFRIS fiscal receipting, analytics dashboards.

**Phase 3:** insurance/NHIS claims module (only if/when NHIS is enacted), inter-clinic referral network, credit/BNPL partnerships, USSD access for non-smartphone patients.

**Explicitly OUT of scope for v1 (and why):**
- **Insurance/NHIS claims** — NHIS is unenacted and stalled; private-insurer claim formats are fragmented; building now is speculative.
- **Full pharmacy inventory/ERP** — ClinicMaster and others already do this well; competing head-on wastes the solo founder's time. Integrate later, don't lead with it.
- **Lab machine integration & hardware** — capital- and support-heavy; defer.
- **Employing clinicians, holding drugs, holding funds** — each would convert the platform into a regulated healthcare provider or payment service provider. Never do this.

### D. Target Customer Segmentation

**Beachhead: owner-operated urban private-for-profit clinics and small polyclinics in Kampala, Wakiso and Mukono, 3–10 staff, that hold their own NDA-licensed pharmacy on-premises and a UMDPC-registered supervising doctor.** Justification:
- They have the regulated assets (pharmacy licence, clinician) so the platform stays software-only.
- They feel Rocket Health competition most acutely (urban, smartphone-owning patients).
- ~70% of private-for-profit facilities are in central Uganda/greater Kampala, so density lowers the founder's support and demo cost.
- They are big enough to pay a monthly fee but too small to commission custom software or afford ClinicMaster-scale HMIS.
- Owner is usually a single decision-maker (a doctor or the doctor's spouse), shortening the sales cycle.

Secondary segments (Phase 2): standalone NDA-licensed retail pharmacies wanting online refills + delivery; small private hospitals (11–40 beds) wanting a patient-facing teleconsult layer on top of an existing HMIS.

### E. Competitive Positioning

| Product | Origin | What it is | Pricing (where known) | Strengths | Gaps vs this plan |
|---|---|---|---|---|---|
| **ClinicMaster** | Kampala (2009) | Full HMIS/EMR: registration, EMR, pharmacy, lab, insurance claims | Not publicly published for the Ugandan product (the $65/mo "Clinicmaster" is an unrelated Canadian firm) | 180+ facilities in 5 countries; "more than 20 million patients"; mature; local | Not a patient-facing teleconsult/delivery front door; not mobile-money-first; heavier/pricier for a 3-person clinic |
| **Stre@mline** | SW Uganda (istreams) | Offline-first hospital EHR | Not published; "economically sustainable without donor funding" | Works offline; proven at Kisiizi; low-resource fit | Hospital-oriented; not teleconsult/e-commerce; limited urban private-clinic focus |
| **EasyClinic** | India (marketing to UG) | Cloud EMR + telemedicine + mobile-money billing | Tiered Starter/Advanced/Enterprise; not UG-priced publicly | Feature-rich; telemedicine built-in | Not Ugandan-built; India-standard compliance (NDHM); no local support/last-mile delivery; weak local trust |
| **Helium Health** | Nigeria | EMR/HMIS + wallet + credit + HeliumDoc telemedicine | Enterprise/negotiated | US$42.12m raised; multi-country; credit product | Enterprise/hospital focus; not a cheap self-serve tool for a 3-staff Kampala clinic; no own-pharmacy-delivery workflow |
| **Rocket Health / TMCG** | Uganda | Vertically integrated telemedicine (own pharmacy/lab/clinicians/fleet) | B2C consultation + delivery fees | Brand leader; 25,000+ patients; US$6.2m funded | **Not a software vendor** — it's the competitor the clinics are losing to; unlikely to white-label its crown jewels soon |
| Generic vendors (Movetech, SmartHospitalManager, OpenMRS/Bahmni) | Various/OSS | HMIS / open-source EMR | OSS free; integrators charge for deployment | Cheap/free licence | No teleconsult+MoMo+delivery bundle; OSS needs an integrator and self-hosting; not turnkey white-label |

**Verdict on the whitespace claim:** It **partially survives**. "Clinic software" and "EMR" are contested and partly saturated; leading with those is a mistake. But the **specific bundle** — non-custodial mobile-money teleconsult + e-prescription + own-pharmacy dispensing + delivery dispatch, white-labelled to each clinic, built and supported locally — has no obvious direct incumbent. **Reposition from "clinic management software" to "your clinic's own Rocket Health — teleconsult, pay by MoMo, get medicine delivered, on your brand."** Compete on workflow + price + local support + Ugandan data residency/trust, not on EMR breadth.

Open-source (OpenMRS, Bahmni, GNU Health, OpenEMR) is a real *price* threat but not an *entrenchment* threat in small urban private clinics: these are self-hosted, integrator-dependent, and lack MoMo/teleconsult/delivery out of the box. They set a psychological "software should be cheap/free" anchor the plan must beat on turnkey convenience.

### F. Business Model and Pricing

**Recommended structure — subscription first, transaction fee optional and later.** Ugandan small clinics have thin cash and distrust revenue-share; a predictable monthly SaaS fee is the easiest first sale. Suggested tiers (USD at ~UGX 3,700/USD):

| Tier | Target | Monthly (UGX) | ≈ USD | Included |
|---|---|---|---|---|
| **Starter** | Solo/3-staff clinic or single pharmacy | 150,000 | ~40 | Booking, teleconsult, basic records, e-prescription, MoMo collection, SMS bundle |
| **Clinic** | 4–10 staff clinic w/ own pharmacy | 350,000 | ~95 | + delivery dispatch, multi-user roles, prescription-to-pharmacy, reconciliation dashboard |
| **Polyclinic/Small hospital** | 10+ staff, multi-department | 750,000–1,200,000 | ~200–325 | + inventory (Ph2), lab (Ph2), analytics, priority support, EFRIS receipting |
| **Setup/onboarding (one-off)** | All | 200,000–500,000 | ~55–135 | Branding, data entry, staff training |

Add **metered pass-throughs**: SMS at cost + small margin; delivery is clinic-arranged (platform only dispatches).

**Transaction-fee layer (Phase 2, optional):** a small platform fee (e.g. 1–1.5%) *on top of* the aggregator's ~3–3.5%, charged on teleconsult/prescription payments — but only under a **strictly non-custodial architecture**: the patient pays via the licensed aggregator (Flutterwave PSO/Pesapal PSO), funds settle **directly to the clinic's own MoMo/bank account**, and the platform's fee is invoiced separately to the clinic (or netted by the aggregator as a sub-merchant split) so the platform **never holds client funds**. This avoids the NPS Act's PSP/e-money-issuer licence (the custody-triggered category, capital UGX 250M–10bn). **However**, because the NPS Act's "aggregator/integrator/third-party system" PSO definitions are activity-based (not custody-based) — the lowest PSO threshold being UGX 100m capital — obtain a **written no-objection from the Bank of Uganda National Payment Systems Department** before switching on any percentage fee. Until then, keep payments as a pure convenience feature with no platform cut.

**Illustrative revenue paths (assumptions labelled):**
- *Assume* blended ARPU UGX 300,000/month.
- **UGX 10m/month:** ~33 paying clinics. Achievable in ~9–15 months solo.
- **UGX 50m/month:** ~165 clinics, or ~110 clinics + transaction fees + SMS margin. Needs a small support hire and referral engine (~24–30 months).
- **UGX 200m/month:** ~500+ clinics or a materially larger transaction take-rate across the base — this is the threshold where the business either needs capital/hires or the payment-flow pivot; realistically a 3–5 year, no-longer-solo goal.

### G. Go-to-Market Plan (zero budget)

**Named, free/low-cost channels:**
- **Uganda Healthcare Federation (UHF)** — the umbrella body for private providers; sponsors the Private Health Sector Convention; the single highest-leverage door to clinic owners.
- **Medical Bureaus** — Uganda Catholic Medical Bureau (UCMB), Uganda Protestant Medical Bureau (UPMB), Uganda Muslim Medical Bureau (UMMB) for PNFP reach.
- **Professional bodies & CPD/CME events** — Uganda Medical Association (UMA), Pharmaceutical Society of Uganda (PSU), Allied Health Professionals Council networks, and clinic-owner WhatsApp groups.
- **Health Information Systems Program (HISP) Uganda** and **USAID's Strengthening Local Health Systems (SLHS)** activity (MSH-led, launched January 2025, with UHF and HISP as named partners) — potential deployment funders for private-sector digitisation (note: US health-aid flows to Uganda are being restructured/reduced in 2025, so treat donor money as upside, not the base case).
- **The founder's own ICT consultancy** — existing client relationships, invoicing entity and credibility.

**First-50-clinics acquisition plan (sequenced):**
1. **Weeks 0–6 (validation, no code):** interview 25–30 Kampala/Wakiso clinic owners; confirm the teleconsult+MoMo+delivery pain, price sensitivity and current tools. Recruit 3 design-partner clinics.
2. **Months 2–5 (pilot):** deploy MVP free to 3–5 design partners in exchange for testimonials and referrals; instrument everything; nail onboarding time to <1 day.
3. **Months 5–9 (paid beachhead):** convert design partners to paid; use them as reference sites; run demos at one UHF/CME event; target clinic clusters (e.g. Ntinda, Kansanga, Nsambya, Kira Road) for word-of-mouth density.
4. **Months 9–15 (referral engine):** formal referral scheme (one month free per referred clinic that converts); publish 2–3 case studies; expand to Mukono/Entebbe/Jinja.

**Sales-cycle expectation:** East African clinic-software sales are relationship-led and slow; expect **1–4 months** from first contact to paid for a small owner-operated clinic, longer for hospitals. Budget for a long nurture with WhatsApp follow-up and in-person demos.

### H. Operational and User Flows

*(Actors: Patient, Clinic Administrator, Clinician, Clinic Pharmacist, Rider/Dispatcher, Platform System, Aggregator, SMS Gateway.)*

**H1. Clinic onboarding (first contact → first consultation)**
1. Admin signs up; System creates an **isolated tenant** (own schema/row-level tenant_id; own subdomain/brand).
2. Admin uploads clinic logo, colours, services, prices, working hours; uploads supervising clinician's UMDPC number and the clinic's NDA pharmacy licence reference (stored as compliance evidence, not verified by platform).
3. Admin connects the clinic's **own** Flutterwave/Pesapal merchant account (OAuth/API keys) so settlement targets the clinic's account.
4. Admin invites clinicians/pharmacist/rider; each gets role-scoped access.
5. System runs an onboarding checklist; PDPO consent templates and privacy notice are activated.
6. *Exception:* if no aggregator account, System offers a guided sign-up link; consultations can still run cash/at-desk until payments are live.
7. First test consultation booked internally to validate video, notes and prescription PDF.

**H2. Patient registration & consent (DPPA 2019)**
1. Patient self-registers (name, phone, optionally NIN) or Admin registers walk-in.
2. System presents a **plain-language consent screen**: what data is collected, purpose, that health data is special-category, retention, sharing (only with the treating clinic and, for delivery, the rider), and withdrawal rights. Patient must actively tick to proceed; consent event is timestamped and logged (immutable audit).
3. OTP verifies phone ownership.
4. *Exception:* patient declines consent → registration halts; no clinical data stored beyond the minimal contact needed to explain why service can't proceed.
5. Minors: guardian consent captured per DPPA special provisions.

**H3. Teleconsultation (book → pay → consult → notes → prescription)**
1. Patient picks service + clinician + slot.
2. System shows fee; Patient pays via MoMo/card (see H5) **or** selects pay-at-clinic.
3. On payment success (or approved deferral), booking confirms; SMS/WhatsApp to Patient + Clinician.
4. At slot, Clinician joins video/voice/chat; System logs start/end.
5. Clinician records notes/diagnosis in the tenant record; if medication indicated, Clinician issues an **e-prescription** (PDF with clinician name + UMDPC number + timestamp). Legality rests on the clinic's own licensed clinician exercising clinical judgement — the platform only records it.
6. *Exceptions:* patient no-show (auto-mark, refund policy per clinic); dropped call (resume link); clinician judges remote care unsafe → converts to in-person referral, no prescription.

**H4. Prescription → dispensing → delivery**
1. E-prescription routes to the clinic's **own licensed pharmacy** queue.
2. Clinic Pharmacist reviews, confirms stock, prices the order; Patient notified with total.
3. Patient chooses pickup or delivery; pays for medicines + delivery (H5) — again settling to the clinic.
4. If delivery: Dispatcher assigns a Rider; System shares delivery address + item list (minimum necessary data) and a status thread (assigned → picked up → en route → delivered).
5. Pharmacist dispenses per NDA rules (only the pharmacy's licensed staff dispense; platform never handles drugs).
6. *Exceptions:* out of stock → Pharmacist proposes substitute (needs clinician re-approval) or partial fill; failed delivery → return-to-pharmacy state + refund/reschedule; controlled/Class-A/B drugs flagged for stricter in-person handling per NDPA Act Cap 206.

**H5. Payment flow (non-custodial) with failure states**
1. Patient initiates payment; System calls the **clinic's** aggregator (Flutterwave/Pesapal) — funds are destined for the **clinic's** account, never the platform's.
2. Aggregator triggers MoMo push (MTN/Airtel) or card 3DS.
3. States: **pending** (awaiting PIN/confirmation — System polls/webhook), **success** (booking/order proceeds; receipt + SMS), **failed/timeout** (retry option; nothing proceeds), **reversed** (rare; reconciliation flag).
4. **Reconciliation:** System stores the aggregator transaction ID against the booking/order; a daily reconciliation view flags mismatches for the Admin. Because settlement is direct to the clinic, the platform reconciles *records*, not *money*.
5. *Optional Phase-2 platform fee* is either invoiced monthly to the clinic or split by the aggregator as a sub-merchant fee — pending Bank of Uganda no-objection.
6. *Exceptions:* webhook missed → reconciliation polling backstop; duplicate charge → idempotency key prevents double booking.

**H6. Lab request & result return (Phase 2)**
1. Clinician orders a test tied to the visit; routes to clinic's own lab (or partner lab, later).
2. Sample collected/logged; result entered by lab staff; attached to record; Patient notified results are ready (results themselves shown in-app under consent, not by SMS).
3. *Exceptions:* critical values flagged for urgent clinician callback; external lab integration deferred until demand proven.

**H7. Multi-tenant isolation & clinic-admin flow**
1. Every record carries an immutable tenant_id; queries are tenant-scoped (row-level security in PostgreSQL); one clinic can never read another's data.
2. Admin manages users/roles (clinician, pharmacist, dispatcher, front-desk), service catalogue, prices, hours, branding and aggregator keys.
3. Admin sees usage, revenue (informational, from records), SMS balance, and an audit log of consent and access events.
4. *Exceptions:* offboarding a clinic → data export to the clinic (data-controller obligation) then secure deletion per retention policy.

### I. Regulatory and Compliance Plan (responsibility assigned)

| Obligation / licence | Responsible party | Notes |
|---|---|---|
| Clinic/health-unit licence (UMDPC) | **Clinic** | Platform records the reference; never operates a facility |
| Clinician registration + Annual Practising Licence (UMDPC/AHPC/Nurses & Midwives Council) | **Clinic/clinician** | Remote consult is the clinician's clinical act; platform is a tool |
| NDA pharmacy/drug-shop licence + dispensing | **Clinic pharmacy** | Only licensed pharmacy dispenses; controlled drugs per NDPA Act Cap 206 |
| Remote prescribing legality | **Clinician** (under existing law) | No enacted telemedicine law yet; monitor MoH's forthcoming telemedicine regulations and adapt |
| **PDPO registration (DPPA 2019)** | **Platform** (as processor/controller) **and each clinic** (as controller) | Platform registers via pdpo.go.ug: pay UGX 100,000 (URA PRN), submit Form 2 + Form 3 (Commissioner for Oaths), nominate a Data Protection Officer. Health data = special category → stronger safeguards, encryption, access logs, consent capture |
| Cross-border data transfer / localisation | **Platform** | DPPA restricts transfers without adequate safeguards; Google precedent (July 2025). **Host in-country or in a jurisdiction with safeguards + a data-transfer agreement**; prefer Ugandan/African data residency for trust |
| Payment collection (NPS Act 2020) | **Aggregator** (Flutterwave PSO / Pesapal PSO) | Non-custodial design keeps the **platform** out of PSP/e-money licensing. Before any platform transaction fee, get **BoU written no-objection** because "aggregator/integrator" PSO definitions are activity-based |
| Health-information-system certification (NITA-U) | Monitor | No clear published mandate that private-provider HIS require NITA-U certification today, but MoH's forthcoming digital-health/EMR guidelines may introduce standards; design for interoperability (HL7/FHIR-ready) |
| NHIS claims | Defer | Bill unassented/stalled; build only when enacted with published claim formats |

**What the platform must NOT do (to avoid becoming regulated):** employ or contract clinicians as its own; hold or dispense drugs; take custody of patient funds or run a wallet/float; guarantee clinical outcomes; issue prescriptions in its own name; or advertise health services as a provider (UMDPC restricts health-service advertising). Stay a **software supplier and data processor** only.

### J. Risk Register (ranked)

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| 1 | **Clinic willingness/ability to pay** (thin cash, "software should be free" anchor from OSS) | High | High | Low entry price; free pilot → paid; tie price to demonstrated new revenue (teleconsult/delivery); annual-prepay discount |
| 2 | **Incumbent competition** (ClinicMaster, Helium, EasyClinic) | High | Medium | Don't fight on EMR; win on teleconsult+MoMo+delivery bundle, local support, price, Ugandan data residency |
| 3 | **Founder capacity** (solo, part-time MD of a consultancy) | High | High | Ruthless MVP scope; templatised onboarding; async support; first support hire at ~UGX 20m/month MRR |
| 4 | **Telemedicine law lands unfavourably** (MoH drafting now) | Medium | High | Keep clinical act on the clinic's clinician; engage UHF/MoH consultations; architect to add mandated controls |
| 5 | **Data breach liability** (special-category health data) | Medium | High | Encryption at rest/in transit; tenant isolation; access logs; PDPO registration + DPO; incident plan; cyber-hygiene |
| 6 | **NPS Act reclassification** of the platform as a PSO aggregator | Medium | High | Strictly non-custodial; BoU no-objection before any % fee; keep aggregator as the licensed party |
| 7 | **Rocket Health / a funded player white-labels** its stack | Low–Medium | High | Move fast on beachhead density and switching-cost lock-in (data, workflows, patient lists); local relationships |
| 8 | **Free/OSS undercut** (OpenMRS/Bahmni) | Medium | Medium | Turnkey convenience, no self-hosting, MoMo/teleconsult/delivery built in, local support |
| 9 | **NHIS enacted suddenly → disruption/opportunity** | Low (near term) | Medium | Modular claims-ready design; treat as upside; don't build ahead of published rules |
| 10 | **Donor-funding volatility** (US aid restructuring 2025) | Medium | Low–Medium | Treat donor deployments as upside, not base case; base model on clinic-paid subscriptions |

### K. Roadmap and Milestones (solo, realistic)

- **Phase 0 — Validation (Months 0–1.5, no code):** 25–30 owner interviews; 3 design partners signed. **Go criterion:** ≥3 clinics commit to pilot + ≥10 express willingness to pay ≥UGX 150k/month. **Kill:** <2 willing to pilot or price ceiling below hosting+support break-even.
- **Phase 1 — MVP (Months 1.5–6):** build H1–H5 flows; PDPO registration; deploy to design partners. **Go:** onboarding <1 day; ≥3 clinics running weekly teleconsults; ≥1 paying by month 6. **Kill:** no clinic will pay after pilot.
- **Phase 2 — Paid beachhead & scale (Months 6–18):** referral engine; add delivery dispatch polish, SMS margin, EFRIS; reach **UGX 10m/month (~33 clinics)**. **Go:** MRR growth ≥15%/month; churn <5%/month. **Kill:** churn >10%/month sustained or CAC (mostly time) unsustainable.
- **Phase 3 — Depth & optional pivot (Months 18–36):** inventory, lab, analytics; test transaction-fee layer (post-BoU no-objection); first support hire; target **UGX 50m/month**. **Go/venture gate:** ≥150 active clinics AND measurable payment/prescription flow → consider raising to accelerate; otherwise continue as a high-margin bootstrapped business.

### L. What Would Make This Investable
As designed (subscription SaaS to a few thousand urban clinics), this is a **bootstrapped cash business**, not a venture deal — the serviceable market caps out in the low single-digit billions of UGX/year. It becomes **venture-scale only by capturing transaction economics**: taking a small, recurring cut of consultation and (especially) **prescription/medicine payment flow** across hundreds of clinics — the same fintech-on-top-of-health-rails logic behind Helium Health's US$30m Series B (June 2023, led by AXA IM Alts, with HeliumCredit/HeliumWallet as the growth thesis). Traction milestones investors would want: ~150–300 active clinics, high net revenue retention, low churn, demonstrated take-rate on payment flow, and a credible path to embedded finance (clinic working-capital or patient BNPL). Likely investor types: African health-tech/fintech seed funds and the same class of backers behind Rocket Health and Helium — LoftyInc, Launch Africa, Global Ventures, Creadev-type strategics, plus DFIs/impact investors (IFC, FMO) given the UHC angle. Absent that pivot, keep it bootstrapped and profitable.

### M. Honest Assessment
**The single biggest reason this fails: clinics won't pay enough, soon enough, for a solo part-time founder to reach escape velocity before burning out.** Willingness-to-pay is the binding constraint — not technology, not regulation, not competition. Small Ugandan clinics run on thin cash, are anchored to free/cheap software, and buy on relationships and demonstrated new revenue, not features. If teleconsult + delivery does not visibly *make the clinic money*, the subscription is the first cost cut.

**Did the research change the thesis?** Yes, in two ways. (1) The "no competition" premise is **too strong** — clinic/EMR software is crowded (ClinicMaster, Stre@mline, EasyClinic, Helium), so the plan must **reposition away from "clinic software" toward the specific, un-served teleconsult+MoMo+own-pharmacy-delivery bundle** and win on workflow/price/local support. (2) The regulatory read is **more favourable than feared** for a software-only, non-custodial model — the main open items are the *pending* telemedicine regulations and a BoU no-objection before charging payment fees. The core "arms dealer, not combatant" logic holds and is, if anything, reinforced: the founder should sell shovels (software) to the licensed miners (clinics), never mine (provide care) himself.

## Recommendations
1. **Run Phase 0 before writing code.** Interview 25–30 Kampala/Wakiso clinic owners; get 3 design partners and ≥10 price commitments. Kill or proceed on that evidence.
2. **Reposition the product.** Market it as "your clinic's own Rocket Health — teleconsult, pay by MoMo, medicine delivered, on your brand," not as "clinic management software." Lead with the un-served bundle; treat EMR as table stakes, not the pitch.
3. **Build the tight MVP only (H1–H5).** Defer inventory, lab, claims and hardware. Obsess over <1-day onboarding and demonstrable clinic revenue uplift.
4. **Lock in compliance early and cheaply.** Register with PDPO (UGX 100,000), appoint a DPO, encrypt and isolate tenants, host with Ugandan/African data residency, and keep payments strictly non-custodial via Flutterwave/Pesapal.
5. **Get a Bank of Uganda written no-objection** before switching on any platform transaction fee; until then keep payments a free convenience feature.
6. **Use free channels first:** UHF, Medical Bureaus, UMA/PSU CME events, clinic WhatsApp clusters, and the founder's consultancy network; build a referral engine from the first paying clinics.
7. **Set staged financial gates:** UGX 10m/month (~33 clinics) before any spend; first support hire at ~UGX 20m/month; evaluate the venture pivot only at ≥150 clinics with real payment-flow take-rate.
8. **Benchmarks that change the plan:** if post-pilot conversion to paid is <30% or monthly churn >10%, stop and re-price or re-scope; if MoH's telemedicine regulation imposes provider-side obligations on software, re-assign them to the clinic or add mandated controls; if a funded incumbent launches a comparable non-custodial white-label bundle, accelerate beachhead lock-in or seek capital.

## Caveats
- **Pricing for the Ugandan ClinicMaster and Stre@mline is not publicly published;** the "$65/month Clinicmaster" figure online refers to an **unrelated Canadian company** (ADDATECH, Montréal) and must not be used for the Ugandan product. EasyClinic's Ugandan pricing is also not published. Treat all competitor prices as indicative and verify via demos.
- **Telemedicine law is unsettled:** as of the latest available sources, Uganda has no enacted telemedicine statute; MoH is drafting telemedicine and AI regulations. Remote-prescribing legality currently rests on existing clinician licensure. Re-check before launch.
- **NHIS status:** Bill passed 2021, **unassented and stalled** as of 2025; timelines are uncertain. Do not build claims features on speculation.
- **Payment-fee licensing is genuinely ambiguous:** no published NPS-Act exemption exists for a non-custodial third-party integrator; the safe path is aggregator-as-licensee + BoU no-objection. Aggregator mobile-money collection rates (~3% Flutterwave local / ~3.5% Pesapal) are only partially published and should be confirmed directly. NPS Act capital/fee figures cited (e.g. UGX 100m minimum for a "third-party system" PSO) derive from the FSD Uganda/FITSPA June 2021 guidance reproducing the NPS Regulations 2021; the General Regulations were amended in 2022, so re-verify fee figures against the current amended regulations.
- **SMS per-message pricing in Uganda** varies by provider and volume; only the alphanumeric sender-ID cost (UGX 300,000 MTN monthly / Airtel one-time) is firmly established here — confirm live per-SMS rates with Africa's Talking/Yo Uganda before modelling.
- **Facility counts** blend a 2018 Master List (6,937) with FY2022/23 World Bank figures (8,386; 3,856 private-for-profit); exact *currently-licensed, urban, willing-to-pay* counts are an estimate, not a precise register figure.
- **Revenue projections are illustrative** with assumptions labelled; they are planning scaffolding, not forecasts.