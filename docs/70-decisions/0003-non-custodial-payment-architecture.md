# ADR-0003 — Non-custodial payment architecture

> **Status:** Accepted — §Decision item 2 clarified 2026-08-24 (see *The one merchant account Carevelo does hold*). The decision itself is unchanged.
> **Date:** 2026-08-13
> **Derives from:** Business Plan §F, §H5, §I, §J.6

## Context

Patients pay clinics through the platform. Mobile money — MTN MoMo and Airtel Money — is the dominant method, out-of-pocket spending funds 34–41% of Ugandan health expenditure (§B), and formal insurance covers about 1.1% of the population. Payment is therefore central rather than incidental.

The National Payment Systems Act 2020 licenses payment activity. The **custody-triggered** categories — payment service provider and e-money issuer — carry capital requirements of **UGX 250 million to 10 billion** (§I). A bootstrapped software business cannot meet them. A design that drifted into custody would not inconvenience the company; it would end it.

§F also contemplates a future platform fee of 1–1.5% on payment flow, and §L identifies transaction economics as the only credible route to venture scale. So the design must not merely avoid custody today — it must leave that door open without walking through it.

## Options considered

### A. Platform collects, then disburses to clinics

Simplest product experience. Enables a transaction fee trivially. Full reconciliation visibility.

**Against, fatally:** this is textbook custody. PSP licensing, capital requirements we cannot meet, and holding clinics' money — which small clinic owners would rightly refuse. §I is unambiguous.

### B. Platform holds a wallet or float

Enables refunds, instalments, credit.

**Against:** e-money issuance. The most heavily capitalised category. Not remotely available to us.

### C. Non-custodial — the clinic's own aggregator account — chosen

Each tenant configures its **own** merchant account at a Bank of Uganda-licensed aggregator. Every collection uses **that tenant's** credentials. Funds settle **directly to the clinic**. Carevelo records the attempt and the reported outcome, and reconciles records rather than money.

Both **Flutterwave** (PSO licence announced 28 August 2024) and **Pesapal** (PSO) are licensed to collect on merchants' behalf. The merchant is the clinic.

**Against:** no platform transaction fee without further work; refunds must be executed by the clinic; reconciliation shows what the aggregator reported, not what settled; onboarding gains a step where a clinic must have or obtain a merchant account.

### D. Non-custodial now, sub-merchant split later

Option C, plus a future fee deducted by the licensed aggregator at settlement — the platform still never holding gross funds.

This is C with the door left open, which is what we adopt.

## Decision

**Strictly non-custodial. Carevelo never takes custody of patient funds.**

Concretely:

1. Per-tenant `AggregatorAccount` holding the **clinic's own** credentials — envelope-encrypted, write-only, never returned by any API, never logged.
2. Every collection call **for a patient's payment** uses that tenant's credentials. **No platform-level merchant account exists in that path**, and none can be reached from it — see the clarification below, which was added when subscription billing was built and narrows nothing about patient funds.
3. Settlement targets the clinic's own account.
4. `PaymentIntent` records the attempt and the aggregator's reported outcome. The name is deliberate.
5. Receipts name **the clinic** as payee.
6. **No wallet, balance, float, escrow, hold-and-release, payout, settlement account, or platform-initiated refund.** These entities do not exist, and a CI check on those identifiers fails the build.
7. A platform percentage fee stays **switched off** pending written Bank of Uganda no-objection.

Full detail in [Payments Regulatory Boundary](../50-security-compliance/payments-regulatory-boundary.md) and [H5](../10-product/prd-h5-payments-non-custodial.md).

## The one merchant account Carevelo does hold

*Added 2026-08-24, when clinic subscription billing was built. It clarifies the scope of item 2 rather than changing it, and a reader who only remembers one sentence from this section should remember that no patient's money can reach the account described in it.*

Item 2 was written about patient payments, which is all that existed when it was written, and read on its own it says something broader than was decided: that Carevelo holds no merchant account at all. That was never quite the decision. §Consequences below has always said **"Revenue is subscription-only (§F)"**, and a subscription is money a clinic pays *us*. Until it was automated, that money was collected by invoice and bank transfer — which is a merchant relationship with the clinics, conducted by hand.

So, precisely:

- **Carevelo holds one Pesapal merchant account, and it collects one thing: a clinic's subscription to the software.** Its credentials come from configuration, never from a database row, because `AggregatorAccount` carries a `tenant_id` and a row there means *a clinic's own account* — putting ours among them would create exactly the thing item 2 forbids, one bug away from every existing lookup.
- **A patient's payment cannot reach it.** Different table, different credentials, different resolver, different notification endpoint. The subscription path touches neither `aggregator_accounts` nor `payment_intents`, and a test watches the statements a charge issues and fails if either appears.
- **This is not custody, and is not custody-adjacent.** Custody under the NPS Act 2020 is holding *someone else's* funds. A supplier being paid by its customer holds its own revenue; if collecting one's own fee were custody, every business in Uganda with a merchant account would be a PSP. What would be custody is the platform standing between a patient and a clinic, and that is what the rest of this ADR prevents.
- **§Decision item 7 is untouched.** A platform percentage fee on payment *flow* stays switched off pending written Bank of Uganda no-objection. Charging a clinic a fixed monthly fee for software is a different activity from taking a slice of the money moving between a patient and that clinic, and nothing here brings the second one closer.

**The instruction to the future.** If a change ever makes it possible for a patient's payment to be initiated against, resolved against, or settled into the subscription account, that change is the one this ADR exists to stop — regardless of how convenient the reconciliation edge case it solves. The separation is enforced by four things and all four are load-bearing: platform credentials that cannot be built from a tenant row, a table that no tenant session can read or write, a resolver that shares no code with `PaymentIntentResolver`, and a notification endpoint that takes no tenant.

## The no-objection, and why it is not optional

The reasoning is counter-intuitive and worth stating precisely, because the temptation to skip it is real (§J.6).

Non-custodial design defeats the **PSP** and **e-money issuer** categories, which turn on custody.

It does **not** automatically defeat the **PSO** category. The NPS Act's "aggregator", "integrator" and "third-party system" definitions are **activity-based, not custody-based**, with the lowest PSO threshold at UGX 100 million in capital. Charging a percentage of payment flow is precisely the activity those definitions describe, regardless of who holds the money.

**Non-custodial is necessary but possibly not sufficient.** The only way to know is to ask, in writing, before charging anything.

§ Caveats adds a wrinkle: the figures commonly cited come from FSD Uganda / FITSPA guidance reproducing the NPS Regulations 2021, and the General Regulations were **amended in 2022**. Any figure relied upon in a decision must be re-verified against the current amended regulations.

## Consequences

**Accepted costs.**

- **No transaction revenue** until a no-objection is obtained. Revenue is subscription-only (§F) — collected since 2026-08-24 through Carevelo's own Pesapal account, on the separated path described above.
- **Carevelo cannot refund.** The clinic executes refunds through its own aggregator; we record the outcome. The UI must explain this plainly rather than appear broken.
- **Reconciliation is records, not money.** We cannot see a clinic's balance. The daily view flags mismatches and hands the administrator a specific reference to check on their own dashboard — the most useful thing we can honestly offer.
- Onboarding gains a step, mitigated by a guided sign-up link and a graceful pay-at-clinic fallback (§H1.6).
- Per-tenant credential storage is a high-value secret-management problem ([Threat Model](../50-security-compliance/threat-model.md)).

**Benefits.**

- **No NPS Act custody licensing.** No UGX 250m–10bn capital requirement. This is what makes the business possible at all.
- **Clinics trust it**, and say so — "your money goes straight to your account; we never touch it" is a sales asset as much as a compliance statement. Small clinic owners are correctly suspicious of software that touches their money.
- **PCI scope stays with the aggregator.** Card data never reaches us.
- A platform failure cannot lose a clinic's money, because we never had it.

**Forecloses.** Patient wallets, stored balances, instalments and BNPL under our own name; platform-funded promotions; escrow-style guarantees. Each would require its own licence and, realistically, a different company (§L).

## Revisit when

- **The Bank of Uganda responds on the no-objection** — the primary trigger. A favourable response enables the sub-merchant split, still non-custodially.
- NPS regulations are amended in a way that changes the analysis.
- §L's embedded-finance direction is pursued seriously, which would require a licensed partner and its own regulatory analysis.

**Never** because custody would be convenient. That is not a decision available to us.

## Related

[Payments Regulatory Boundary](../50-security-compliance/payments-regulatory-boundary.md) · [H5](../10-product/prd-h5-payments-non-custodial.md) · [Webhooks](../40-api/webhooks.md) · [Compliance Responsibility Matrix](../50-security-compliance/compliance-responsibility-matrix.md) · [Non-Goals](../10-product/non-goals.md)
