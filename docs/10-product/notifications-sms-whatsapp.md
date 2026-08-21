# Notifications (SMS & WhatsApp)

> **Status:** Draft
> **Last reviewed:** 2026-08-13
> **Derives from:** Business Plan §C, §F, §H

Notifications are how the product actually reaches Ugandan patients — many will interact with Carevelo only through SMS and a browser link. They are also the easiest way to leak special-category health data, because **SMS is not a confidential channel.**

## The content rule

> **No notification may contain clinical content.** Not a diagnosis, not a medicine name, not a test result, not a reason for the appointment.

Messages transit the mobile operator, land on a lock screen anyone nearby can read, and sit in a shared handset's inbox indefinitely. Assume the operator can read them, because the operator can read them.

Clinical content is shown **in-app, under authentication**, and the notification says only that something is ready.

| Never send | Instead |
|---|---|
| "Your malaria test is positive" | "Your results are ready. Sign in to view them." |
| "Your prescription for Amoxicillin is ready" | "Your prescription from {Clinic} is ready." |
| "Your antenatal appointment is confirmed" | "Your appointment with {Clinic} is confirmed for {time}." |
| "Your package containing {medicine} is en route" | "Your package from {Clinic} is on its way." |

§H6.2 states the principle for lab results specifically; it generalises to everything.

## Catalogue

All templates are clinic-branded and identify the clinic as sender ([White-Labeling](white-labeling-and-branding.md)).

| Event | Channel | Content |
|---|---|---|
| Appointment confirmed | SMS + optional WhatsApp | Clinic, date, time, join link |
| Appointment reminder (24h, 1h) | SMS | Clinic, time, join link |
| Appointment cancelled | SMS | Clinic, cancelled slot |
| Payment succeeded | SMS | Clinic, amount, reference |
| Payment failed | SMS | Amount, retry link |
| Prescription ready | SMS | Clinic, sign-in link. **No medicine names** |
| Order priced | SMS | Clinic, total, payment link. **No item list** |
| Order ready for pickup | SMS | Clinic, reference |
| Delivery on its way | SMS | Clinic, tracking link. **No contents** |
| Delivery completed | SMS | Confirmation |
| Results available | SMS (Phase 2) | Sign-in link only |
| Staff invitation | SMS | Clinic, set-up link |

**No message carries a credential.** The platform sends no one-time codes at all, and a patient's initial password is read out at the desk rather than sent ([Auth](../40-api/authentication-and-sessions.md), [ADR-0011](../70-decisions/0011-staff-issued-patient-accounts.md)). The staff invitation is the single exception in spirit and not in fact: it carries a single-use, expiring, tenant-bound token that is spent on first use and grants only a role fixed in advance — not something anyone can sign in with twice.

## Channels

**SMS** is primary and universal. Alphanumeric sender ID registration costs UGX 300,000 (MTN monthly, Airtel one-time) per §F; sender ID shows the clinic's name so the patient recognises it. Per-message rates vary by provider and volume and must be confirmed live with the gateway before modelling (§ Caveats).

**WhatsApp** is opt-in, secondary, and never the sole channel — it requires data and app installation, and template messages must be pre-approved. Note that WhatsApp Business API is hosted outside Uganda, making it a cross-border transfer consideration ([Data Residency](../30-architecture/data-residency-and-hosting.md)). This is one more reason the content rule is absolute: if nothing clinical is in the message, the transfer risk is contained.

**In-app** carries everything clinical. It is the only channel that does.

**In-app realtime** (Laravel Reverb) delivers the *signal* that something changed — a prescription arriving in the pharmacy queue, a substitution needing approval, a payment resolving. It is subject to the **same content rule**: a frame carries identifiers and state, never clinical content. The client then re-fetches through the authorised API, and that response is where clinical data lives ([Realtime Broadcasting](../30-architecture/realtime-broadcasting.md)).

A WebSocket frame is a disclosure surface exactly as an SMS is — and in one respect a sharper one, because a role-scoped channel fans out to every subscriber at once.

## Delivery guarantees

Notifications are queued jobs, not synchronous calls — an SMS gateway timeout must never fail a booking.

- Retry with exponential backoff, three attempts.
- Delivery receipts recorded where the gateway provides them.
- Staff invitations and payment outcomes are highest priority and never batched — somebody is sitting in front of a screen waiting for both.
- Failure to send is surfaced to clinic staff for critical notifications rather than swallowed.
- Rate-limited per tenant to contain both cost and the blast radius of a bug.

Every job carries and restores tenant context. A notification job that runs without it is a bug and is caught by the guard described in [Multi-Tenancy](../30-architecture/multi-tenancy.md).

## Cost and consent

SMS is a metered pass-through billed at cost plus a small margin (§F). Each tenant sees its own balance and consumption; low balance warns the administrator before messages start failing.

Transactional notifications flow from the care relationship and the consent captured at registration. **Marketing messages are not sent — by Carevelo, ever, to patients.** The patient belongs to the clinic ([Non-Goals](non-goals.md)). If a clinic wishes to market to its own patients, that is its decision under its own controller obligations, and it is not an MVP feature.

Opt-out instructions appear where the channel requires them; opt-out never disables a message the patient explicitly requested, nor one the clinic must send to finish something the patient started — an appointment change, a payment outcome, a prescription being ready.

## Acceptance criteria

1. No notification template contains a diagnosis, medicine name, test result or appointment reason. Enforced by a template review test asserting against a prohibited-content list.
2. All templates identify the clinic as sender.
3. Notification sending is asynchronous and cannot fail the originating transaction.
4. No template contains a password, a one-time code or any other credential. The staff invitation's single-use token is the only sign-in material any message carries, and it expires and is spent on first use. Enforced by the same template review test.
5. WhatsApp is opt-in and never the sole channel.
6. Per-tenant rate limits and SMS balance tracking are enforced.
7. Every notification job restores tenant context before rendering.
8. Failed critical notifications are surfaced to staff.
