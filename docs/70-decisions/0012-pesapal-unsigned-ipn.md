# ADR-0012 — Pesapal's unsigned IPN is trusted for nothing

> **Status:** Accepted
> **Date:** 2026-08-24
> **Derives from:** [ADR-0003](0003-non-custodial-payment-architecture.md), Business Plan §H5.3, §H5.6

## Context

Pesapal is the second aggregator, added per clinic under ADR-0003: one Pesapal merchant account per clinic, funds patient → Pesapal → clinic, no platform merchant account anywhere in that path.

*(Since 2026-08-24 Pesapal also collects clinics' **subscriptions to the software** into Carevelo's own merchant account. That is a separate endpoint, `/webhooks/pesapal-billing`, on which everything this ADR decides applies unchanged and one thing more: a recurring notification names no clinic at all, so the payer is read from `subscription_transaction_info.account_reference` in the status response and from nowhere else. See [ADR-0003 §The one merchant account Carevelo does hold](0003-non-custodial-payment-architecture.md).)*

Its inbound notification (IPN) carries exactly three fields:

```
OrderTrackingId · OrderMerchantReference · OrderNotificationType
```

**No status. No amount. No signature, and no shared secret from which one could be derived.** Pesapal does this deliberately: the notification exists to tell a merchant that *something* changed, and the merchant is required to call `GET /api/Transactions/GetTransactionStatus` to find out what.

This is the opposite of Flutterwave, whose callback carries the outcome and an HMAC over the raw body. Our existing webhook endpoint is built entirely around that: [Webhooks](../40-api/webhooks.md) names signature verification as *the* security boundary, and everything downstream of it treats the payload as having genuinely come from the aggregator.

Dropping an unsigned, unauthenticated, publicly reachable endpoint into that design is the kind of change that looks like a small addition and is not. It needs a decision on the record, because the obvious "improvement" a future reader will reach for — believing the notification body — converts it into a way to confirm any booking for free.

## Options considered

### A. Refuse Pesapal until it signs

Honest, and costs us the provider. Pesapal is one of only two BoU PSO-licensed aggregators we can realistically integrate (§I), and a clinic that banks with Pesapal is a clinic we cannot sell to. Rejected as a business answer to a technical question.

### B. Invent a shared secret and require Pesapal to sign

Pesapal will not, and cannot be made to. A secret only we hold verifies nothing.

### C. Trust the notification body when it happens to carry more than three fields

Some payment providers append extra fields; the temptation is to read a status when one is present and fall back to a status call when it is not.

**Rejected, emphatically.** Trust would then depend on what an anonymous caller chose to send — an attacker sends the fields, and gets the trusted path. This is the failure mode this ADR exists to prevent, and it would look like a performance improvement in a diff.

### D. Treat the notification as a hint and read the status from Pesapal — chosen

Take `OrderTrackingId` and nothing else. Use it to find the payment attempt inside one tenant, then call `GetTransactionStatus` over TLS with **that clinic's own credentials**. Apply the answer through the existing `PaymentIntentResolver`, so the amount-mismatch fraud boundary is the same code on every path.

### E. Ignore the IPN entirely and rely on reconciliation

Defensible — the scheduled poll would eventually resolve everything, and this is a system where a webhook is never the only path. Rejected because the graduated schedule is minutes, and a patient standing at a counter having just typed their PIN should not wait minutes to be told their appointment is confirmed. The IPN buys latency, and latency is the only thing it is allowed to buy.

## Decision

**The Pesapal IPN is a hint. It is trusted for nothing, and the endpoint is written so that this is true by construction rather than by care.**

Concretely, `GET|POST /api/webhooks/pesapal/{tenant}`:

1. Reads **one** field from the request — `OrderTrackingId` — in `__invoke()`, and then discards the `Request` object. The method that does the work cannot accept a request, so no later step can reach back for a status, an amount or a tenant hint.
2. Uses the tracking id for exactly two things: a lookup inside one tenant's row-level security context, and the `orderTrackingId` argument to an authenticated call to Pesapal.
3. Takes **every** fact it acts on from that call's response.
4. Applies the result through the existing `PaymentIntentResolver`, unchanged. The amount Pesapal reports is compared against the stored intent and a mismatch applies no state change, exactly as on the signed path.
5. Answers a neutral **404** to an unknown tenant, an unconfigured clinic and an unknown tracking id alike — indistinguishable, because the endpoint is public and confirming which clinics use Carevelo is itself a disclosure.
6. Is idempotent on the tracking id via `WebhookDeliveryLedger`; a replay is a 200 no-op.

**Therefore the most a forged notification can achieve is to make us ask Pesapal a question we were going to ask anyway on the reconciliation schedule, and to receive Pesapal's honest answer.** It cannot assert a payment, cannot assert an amount, and cannot reach an attempt belonging to another clinic.

Nothing from the notification is stored. There is nothing in it worth keeping, and keeping it would invite a later reader to believe it.

### The instruction to the future

**Do not "fix" this by trusting the body.** If a future Pesapal version signs its notifications, verify the signature **in addition to** the status call, never instead of it. The status call is not a fallback for a missing signature; it is where the truth lives.

## Consequences

**Accepted costs.**

- **One outbound call per notification.** Bounded by claiming the idempotency key *before* the status call, so a replayed notification costs one request per order rather than one per delivery.
- **An unauthenticated endpoint can cause outbound traffic.** Only for a tracking id that already exists in our database — a Pesapal-minted GUID that an attacker cannot guess and could at worst replay for a payment they already made.
- **A claim consumed by a delivery we then fail to read is not retried.** If Pesapal is unreachable at that moment the endpoint answers 200 and the delivery stays recorded as `received` — honestly: *we heard, and could not read*. The reconciliation sweep performs the same read on its graduated schedule, which is why this is acceptable rather than a lost payment.
- **Two controllers rather than one.** `PesapalIpnController` sits beside `AggregatorWebhookController` and shares its resolver but not its security model. A single handler with a provider branch would eventually apply one provider's rules to the other's callback.
- **Route ordering is load-bearing.** The Pesapal route must stay declared before `webhooks/{provider}/{tenant}`, or every notification is handed to the signature-verifying controller and rejected as unsigned — a failure indistinguishable from a misconfigured clinic. A test asserts it.

**Benefits.**

- **No shared secret to store, rotate or leak** for Pesapal clinics. The Pesapal `AggregatorAccount` has no webhook secret, and that absence is now a documented statement rather than an omission.
- **One fraud boundary.** The signed webhook, the unsigned notification and the reconciliation poll all converge on `PaymentIntentResolver`, so the amount check cannot drift between three copies.
- **The endpoint's security does not depend on a secret being kept.** There is no secret. That is a stronger position than a shared HMAC key sitting in a database.

**What this forecloses.** Any future optimisation that resolves a Pesapal payment without contacting Pesapal. That is the point.

## Revisit when

- **Pesapal signs its notifications.** Add verification *alongside* the status call, and reconsider only the extra round trip — never the source of truth.
- **The status call becomes a measurable cost** at a volume we do not have and do not expect. Even then the answer is caching a status read, not believing a body.
- **A third aggregator arrives** whose callback is unsigned but carries an outcome. That is a genuinely different case and needs its own decision; do not read this ADR as permission.

## Related

[ADR-0003 Non-custodial payments](0003-non-custodial-payment-architecture.md) · [Webhooks](../40-api/webhooks.md) · [Payments Regulatory Boundary](../50-security-compliance/payments-regulatory-boundary.md) · [Endpoint Catalogue](../40-api/endpoint-catalogue.md) · [H5](../10-product/prd-h5-payments-non-custodial.md)
