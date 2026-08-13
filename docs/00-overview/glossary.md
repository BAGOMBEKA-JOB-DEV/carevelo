# Glossary

> **Status:** Draft
> **Last reviewed:** 2026-08-13
> **Derives from:** Business Plan §I, §F, and general Ugandan regulatory context

Most of these acronyms are load-bearing: they name a regulator whose remit determines whether a design decision is legal. Where a term also has a specific meaning inside our code, that is noted.

## Regulators and statutes

**UMDPC** — Uganda Medical and Dental Practitioners Council. Registers doctors and dentists, issues the Annual Practising Licence, and licenses health units. A prescription's legitimacy rests on a UMDPC-registered clinician acting within their licence. UMDPC also restricts advertising of health services, which is why Carevelo never markets care — only software.

**AHPC** — Allied Health Professionals Council. Registers clinical officers and allied cadres. Many private clinics are run day-to-day by clinical officers, so AHPC registration matters as much as UMDPC in practice.

**Nurses & Midwives Council** — registers nursing and midwifery cadres. Same principle.

**NDA** — National Drug Authority. Licenses pharmacies, drug shops, wholesalers and medical-device outlets, and regulates dispensing under the **NDPA Act** (National Drug Policy and Authority Act, Cap 206). Only NDA-licensed premises staffed by licensed personnel may dispense. Carevelo never holds a licence here because it never touches a drug.

**PDPO** — Personal Data Protection Office. The regulator established under the **DPPA 2019** (Data Protection and Privacy Act 2019). Registration is mandatory for data collectors, processors and controllers; the fee is UGX 100,000 and registration requires Form 2 and Form 3 commissioned by a Commissioner for Oaths, plus a nominated Data Protection Officer.

**DPPA 2019** — Uganda's data protection statute. Health data is **special-category data**, attracting stricter handling. The Act has extraterritorial reach and restricts cross-border transfer without adequate safeguards.

**BoU** — Bank of Uganda. Regulates payments under the **NPS Act 2020** (National Payment Systems Act). Its National Payment Systems Department issues licences and is the body from which a written no-objection must be obtained before Carevelo charges any percentage transaction fee.

**NPS Act 2020** — the payments statute. Defines licence categories including **PSP** (payment service provider) and **e-money issuer** — the custody-triggered categories, carrying capital requirements from UGX 250m to 10bn — and **PSO** (payment system operator), whose "aggregator / integrator / third-party system" definitions are *activity-based rather than custody-based*. This asymmetry is the reason a written no-objection is required even under a non-custodial design.

**NITA-U** — National Information Technology Authority Uganda. Sets government IT standards and certification. No published mandate currently requires private-provider health information systems to be NITA-U certified, but forthcoming MoH digital-health guidelines may introduce standards; we design for interoperability regardless.

**MoH** — Ministry of Health. Currently drafting telemedicine and AI regulations, plus EMR/interoperability guidance. **There is no enacted telemedicine law in Uganda today** — remote prescribing rests entirely on existing clinician licensure. This is a live risk we monitor.

**NHIS** — National Health Insurance Scheme. The Bill passed Parliament in March 2021 but remains unassented and stalled. We do not build claims features against it.

**URA / EFRIS** — Uganda Revenue Authority; Electronic Fiscal Receipting and Invoicing Solution. Fiscal receipting is Phase 2 scope.

**NIRA / NIN** — National Identification and Registration Authority; National Identification Number. Optionally captured at patient registration; never mandatory, because requiring it excludes patients.

## Commerce and payments

**Mobile money (MoMo)** — phone-based payment, dominated in Uganda by MTN MoMo and Airtel Money. The default payment method for our patients. A MoMo collection is *pushed* to the payer's handset for PIN confirmation, which is why payments have a genuinely asynchronous **pending** state rather than an instantaneous result.

**Aggregator** — a licensed intermediary that collects payments on a merchant's behalf across multiple channels. We integrate **Flutterwave** (granted a BoU Payment System Operator licence, announced August 2024) and **Pesapal** (also PSO-licensed). Collection fees are roughly 3% to 3.5%; confirm current rates directly.

**Non-custodial** — the defining property of our payment design: funds move from patient to aggregator to the *clinic's own* account, and at no point rest in an account Carevelo controls. See [Payments Regulatory Boundary](../50-security-compliance/payments-regulatory-boundary.md).

**Sub-merchant split** — an aggregator feature that can deduct a platform fee at settlement without the platform ever holding funds. This is the only mechanism by which a future Carevelo transaction fee may be collected, and only after BoU no-objection.

**PSO / PSP / e-money issuer** — see NPS Act 2020 above. The distinction between them decides whether we need UGX 100m or UGX 10bn in capital, or none at all.

## Clinical

**Teleconsultation** — a consultation conducted remotely by video, voice or secure chat. In Carevelo it is always performed by the tenant clinic's own clinician.

**E-prescription** — a prescription created during a consultation and rendered as a PDF bearing the prescribing clinician's name, registration number and a timestamp. The platform records it; the clinician issues it.

**Dispensing** — supplying medicine against a prescription. Performed exclusively by the clinic's own NDA-licensed pharmacy staff.

**Controlled drugs** — substances subject to stricter handling under the NDPA Act. Carevelo flags these for in-person handling and does not route them through the delivery flow.

**PNFP / PFP** — private-not-for-profit (mission and bureau facilities) and private-for-profit. Our beachhead is PFP; the medical bureaus (UCMB, UPMB, UMMB) are a PNFP distribution channel.

**UHF** — Uganda Healthcare Federation, the umbrella body for private providers and our highest-leverage sales channel.

**HMIS / EMR / EHR** — hospital management information system; electronic medical/health record. A crowded category we deliberately do not lead with.

**HL7 / FHIR** — health data interchange standards. We design to be FHIR-ready without implementing it in the MVP.

## Carevelo-internal terms

These have precise meanings in our code. Use them exactly; see [Ubiquitous Language](../20-domain/ubiquitous-language.md).

**Tenant** — one clinic. The unit of data isolation, branding and billing. Every row of clinical or commercial data belongs to exactly one tenant.

**Platform** — Carevelo itself, as distinct from any tenant. Platform-level data (the tenant register, subscription plans, platform staff) lives outside tenant isolation and is explicitly enumerated.

**Tenant context** — the resolved current tenant for a request or queued job. No query touching tenant data may execute without it.

**Consultation** — the clinical encounter record. Distinct from **Appointment**, which is the booking that precedes it.

**DispenseOrder** — the pharmacy-side work item created from a prescription. Distinct from the prescription itself, which is a clinical document and is never mutated by the pharmacy.

**PaymentIntent** — our *record* of a payment attempt made through the aggregator. It is deliberately not called a "payment" or a "transaction", because Carevelo does not effect payments; it records that one was attempted and what the aggregator said about it.

**ConsentRecord** — an immutable, timestamped record of a patient granting or withdrawing consent, including the exact text version they saw.

**AuditEvent** — an append-only record of a security- or privacy-relevant action. Never updated, never deleted. See [Audit Logging](../50-security-compliance/audit-logging.md).
