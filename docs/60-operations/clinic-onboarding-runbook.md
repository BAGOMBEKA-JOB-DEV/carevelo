# Clinic Onboarding Runbook

> **Status:** Draft
> **Last reviewed:** 2026-08-13
> **Derives from:** Business Plan §G, §K, §H1

The operational procedure behind [H1](../10-product/prd-h1-clinic-onboarding.md). Target: **under one day** — a Phase 1 go/no-go gate (§K), because onboarding cost is what stops a solo founder scaling past a handful of clinics.

**The measure of success is that this runbook becomes unnecessary.** Every step needing a human is a step the product should handle. Track which steps you actually perform; those are the backlog.

## Before first contact

- Confirm the clinic is private-for-profit, urban (Kampala, Wakiso, Mukono), 3–10 staff, with its own on-site NDA-licensed pharmacy and a UMDPC-registered supervising clinician — the beachhead profile (§D).
- Identify the decision-maker. Usually a single person: the doctor, or the doctor's spouse who runs the business (§D). Talking to anyone else wastes both parties' time.

## The demo

Expect **1–4 months** from first contact to paid for a small owner-operated clinic (§G). Relationship-led and slow. Budget for the nurture.

Lead with the un-served bundle — *your clinic's own Rocket Health* — **not** with "clinic management software" (§E). The EMR category is contested and leading with it invites a comparison against ClinicMaster that we do not want.

Demo order, which is deliberate:

1. **A patient books and pays by mobile money on the clinic's own branded page.** This is the moment they understand it.
2. The clinician consults and issues a prescription carrying *their* name and registration number.
3. The pharmacy dispenses; the rider delivers.
4. **The revenue view.** Money the clinic earned. §M says the subscription is the first cost cut when it cannot be traced to income — so show income.

Say plainly, early: **funds go straight to their own account; Carevelo never touches their money.** Clinic owners are correctly suspicious of software that touches their money, and this sentence converts suspicion into a reason to trust us.

## Onboarding session — target under 2 hours

Do it with the administrator, screen to screen, on their device. Watching where they hesitate is the most valuable product research available.

### 1. Sign-up and subdomain — 10 min
Confirm the subdomain with them; **it is immutable afterwards** and appears on printed materials.

### 2. Branding — 20 min
Logo, colours, trading name. Show the live preview. If their colours fail contrast, the system adjusts the foreground automatically — mention it rather than letting them discover it.

Ask for their logo file **before** the session. Chasing it mid-session is the commonest delay.

### 3. Compliance references and the processing agreement — 15 min
Record the UMDPC and NDA references. **State clearly that Carevelo does not verify these** — they are the clinic's own attestation, and we have no access to those registers.

Walk through the data processing agreement: they are the **controller**, we are the **processor** ([Data Protection](../50-security-compliance/data-protection-dppa.md)). Acceptance is recorded with a timestamp.

Mention their own PDPO registration obligation (UGX 100,000). A clinic that fails to register is exposed, and their exposure becomes our commercial problem even where it is not our legal one.

### 4. Services and prices — 30 min
The longest step. The starter catalogue helps; prices are always theirs.

Reasonable to defer: the full catalogue can wait. **Three services are enough to go live**, and going live is what matters.

### 5. Payment connection — 20 min
Connect their **own** Flutterwave or Pesapal account. Run the sandbox verification.

**If they have no merchant account** (§H1.6): give them the guided sign-up link and **continue**. They go live on pay-at-clinic and connect payments later. Do not let this block onboarding — it is the single most common stall, and blocking on it loses the momentum built during the demo.

Note the SMS sender-ID registration cost — UGX 300,000, monthly with MTN or one-off with Airtel (§F). It belongs in the setup-fee conversation, not as a surprise.

### 6. Staff — 15 min
Invite by phone number. Capture registration body, number and prescribing capability for clinicians — **a clinician cannot prescribe without them.**

### 7. Consent templates — 10 min
Review the pre-drafted DPPA-compliant consent and privacy notice. They may extend; the mandatory elements stay.

### 8. Test consultation — 20 min
Run one end to end against the seeded test patient: video, note, prescription PDF.

**This is the moment the product proves itself.** Do not skip it because time is short — a clinic that has seen its own prescription PDF with its own clinician's name on it is a different prospect from one that has not.

## First week

| Day | Action |
|---|---|
| 1 | Confirm staff have signed in. Chase anyone who has not |
| 2 | First real patient booked — walk the front desk through it live |
| 3 | Check the first payment reconciled; show them the reconciliation view |
| 5 | Check in: what is confusing, what is missing, what have they stopped using |
| 7 | Show the revenue view with real numbers on it |

**The first real patient is the conversion moment.** A clinic that gets through one complete real consultation usually continues; one that does not, usually does not.

## First month

- Weekly check-in, dropping to fortnightly.
- Watch for the pharmacy queue going unused — it usually means the pharmacist was never properly onboarded, which is a separate half-hour, not a product problem.
- At week 3, ask for the referral. §G's engine is one month free per referred clinic that converts, and a clinic that has just seen its own revenue view is the right moment to ask.
- Convert from pilot to paid per the design-partner agreement (§K).

## Common failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Onboarding stalls at payments | No merchant account | Continue on pay-at-clinic. Never block |
| Staff never sign in | Invitation SMS not received, or nobody told them | Resend; call. Onboard the pharmacist separately |
| Pharmacy queue unused | Pharmacist not trained | A dedicated half-hour with them |
| No teleconsultations after week 2 | Patients do not know it exists | Give them the patient-facing material; a WhatsApp status post is usually enough |
| Administrator never returns after signup | Momentum lost | Resume links at 24h, 3d, 7d. Then call |
| "Software should be free" | The open-source anchor (§J.1) | Do not argue on price. Show the revenue view |

## What to record

Every onboarding, because these numbers drive the product backlog:

- Elapsed time and hands-on time.
- Which steps needed you, and why.
- Where they hesitated.
- Whether they had a merchant account.
- Time to first real consultation, and to first payment.

**Any step that needs you in three consecutive onboardings is a product defect**, not a training issue. Fix the product.

## Offboarding

If a clinic leaves, [Retention & Deletion](../50-security-compliance/data-retention-and-deletion.md) applies: export first, confirm receipt, 30-day grace, then delete.

**The export is provided regardless of any commercial dispute.** Withholding it would be unlawful and would harm patients. Ask what went wrong, and record the answer honestly — churn reasons are the most valuable data in the business (§K's kill criteria depend on them).
