# White-Labeling & Branding

> **Status:** Draft
> **Last reviewed:** 2026-08-13
> **Derives from:** Business Plan §C, §E, §H1

White-labeling is the product, not a theme setting. The pitch is *your clinic's own Rocket Health* (§E) — and a patient who sees Carevelo's name where their clinic's should be has been told, correctly, that they are dealing with a stranger.

## Principle

**The patient-facing surface belongs to the clinic. The staff-facing surface belongs to Carevelo.**

| Surface | Branding | Reasoning |
|---|---|---|
| Patient portal | **Clinic only.** Clinic logo, colours, name, contact | The patient's relationship is with the clinic |
| Prescription PDF | **Clinic and clinician only.** Carevelo appears nowhere as issuer | The clinician issued it under their own registration ([H3](prd-h3-teleconsultation.md)) |
| Receipts | **Clinic as payee.** Carevelo is not a payee | The clinic received the money ([H5](prd-h5-payments-non-custodial.md)) |
| SMS / WhatsApp | Clinic name as sender and in content | The patient must recognise who is contacting them |
| Clinic console | Carevelo branding, with the clinic's logo in the header | Staff know they use Carevelo; the clinic is the customer |
| Platform admin | Carevelo | Internal |

A discreet "powered by Carevelo" may appear in the patient portal footer, and must be removable on higher tiers. It is worth remembering that this footer is our single best acquisition channel — another clinic owner seeing it is exactly the referral dynamic §G depends on — but it comes second to the clinic's confidence in its own brand.

## What a clinic controls

- Logo (patient-facing header, prescription PDF, receipts).
- Primary and secondary colour.
- Trading name, tagline, contact details, physical address.
- Service catalogue, descriptions and prices.
- Consent and privacy notice text, extending but not removing the mandatory DPPA elements ([H2](prd-h2-patient-registration-consent.md)).
- Notification templates, within the content rules in [Notifications](notifications-sms-whatsapp.md).
- Subdomain `{slug}.carevelo.app`; custom domains in Phase 2.

## What a clinic does not control

And this is the important half.

- **No arbitrary CSS, HTML or JavaScript.** Branding is applied exclusively through validated design tokens. Free-form CSS in a multi-tenant health application is a cross-site scripting vector and, given what is on these screens, an exfiltration vector for special-category data. The answer is no, permanently, regardless of how much a clinic wants a particular font.
- **No layout or flow changes.** Support cost scales with variation, and a solo founder cannot support several materially different products (§M).
- **No removal of mandatory legal elements** — consent text, privacy notice, the unverified-attestation disclaimers.
- **No claim implying Carevelo verified anything** ([Non-Goals](non-goals.md)).

## Implementation

Branding is a small, strictly typed token set resolved per tenant and injected as CSS custom properties:

```
--brand-primary        #RRGGBB, validated hex
--brand-primary-fg     computed for contrast, not chosen
--brand-secondary      #RRGGBB, validated hex
--brand-surface        derived
--brand-logo-url       signed URL to a validated image
```

**Validation on entry, not on render.** Colours must match a strict hex pattern; anything else is rejected before storage. Never interpolate a stored value into a stylesheet without validating it first — a tenant-supplied string reaching a `<style>` block is the whole attack.

Foreground colours are **computed for WCAG AA contrast rather than chosen by the clinic.** A clinic that picks pale yellow gets readable text anyway. This is not a preference we are overriding lightly; an unreadable dosage instruction is a safety problem.

Logos are validated for format, dimensions and size, stripped of metadata, re-encoded server-side (never trusting the declared type), and served from tenant-partitioned storage ([Identifiers](../20-domain/identifiers-and-numbering.md)).

## Tenant resolution

The patient portal resolves its tenant from the subdomain, **before any query runs**, and the branding is server-rendered — no flash of Carevelo branding before the clinic's loads. See [Multi-Tenancy](../30-architecture/multi-tenancy.md) and [Frontend](../30-architecture/frontend-nextjs.md).

An unknown subdomain returns a neutral not-found page. It must never confirm or deny whether a given clinic uses Carevelo — that is the clinic's commercial information, and enumeration of our customer list should not be a `for` loop over subdomains.

## Acceptance criteria

1. No tenant-supplied value can inject CSS, HTML or JavaScript into any rendered page. Covered by test with hostile inputs.
2. Colour values are validated against a strict pattern before storage.
3. Foreground colours meet WCAG AA contrast regardless of the tenant's choice.
4. Uploaded logos are re-encoded server-side and stripped of metadata.
5. The patient portal carries no Carevelo branding beyond the removable footer.
6. Prescription PDFs name the clinician and clinic as issuer, never Carevelo.
7. Branding is server-rendered with no flash of unbranded content.
8. An unknown subdomain reveals nothing about tenant existence.
9. Tenant A's branding assets are unreachable from tenant B.
