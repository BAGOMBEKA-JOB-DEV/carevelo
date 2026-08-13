# Definition of Done

> **Status:** Draft
> **Last reviewed:** 2026-08-13

The bar for merging. Short enough to actually check.

## Every change

- [ ] Does what the PRD or issue asked, including the **exception paths** — §H's exception branches are the most valuable content in the business plan and the most commonly dropped in implementation.
- [ ] Tests written and passing; failure cases covered, not only the happy path.
- [ ] All CI gates green ([Release Process](../60-operations/release-process.md)).
- [ ] No new PHPStan or TypeScript suppressions without a comment explaining why.
- [ ] Migration is backward-compatible with the previous release.
- [ ] Documentation updated in the same change where the change alters documented behaviour.
- [ ] Self-reviewed as a diff before requesting review.

## If it touches tenant-scoped data

- [ ] `tenant_id` on every new table; **RLS enabled and forced in the same migration** (`Schema::enableTenantIsolation()`).
- [ ] Composite foreign keys on `(tenant_id, id)`.
- [ ] **A cross-tenant isolation test for every new model**, exercising all four access paths ([Test Strategy](test-strategy.md)).
- [ ] Any new queued job extends `TenantAwareJob` or is explicitly `#[PlatformScoped]`.
- [ ] Any new cache key is tenant-namespaced. **A manually constructed key without a tenant prefix is a defect.**
- [ ] Any new table that is genuinely platform-scoped is added to the list in [Multi-Tenancy](../30-architecture/multi-tenancy.md) in the same change.

## If it touches clinical data

- [ ] Minimum necessary data in every response. **A new field on a rider-facing or notification payload is a disclosure decision** — justify it.
- [ ] Clinical records remain immutable: corrections by addendum or supersession, never overwrite.
- [ ] Access is authorised by policy and **written to the audit log**.
- [ ] Nothing clinical reaches a log line, a notification, or an error response.
- [ ] Consent state is respected — no processing for a patient in `pending_consent` or `withdrawn`.

## If it touches payments

- [ ] **No entity, column or code path represents a Carevelo-held balance.** The forbidden-identifier check must pass, and passing it by renaming a variable is not compliance ([Payments Regulatory Boundary](../50-security-compliance/payments-regulatory-boundary.md)).
- [ ] Every aggregator call uses the **tenant's own** credentials.
- [ ] Credentials cannot reach a response, a log line or an exception trace.
- [ ] Idempotency covered by test.
- [ ] Callback amounts validated against the stored intent.
- [ ] Every state transition audited.
- [ ] Reconciliation still resolves the intent independently of the webhook.

## If it touches authentication or authorisation

- [ ] Policy exists for the resource; **default is deny.**
- [ ] Denial tested, not only permission ([RBAC Matrix](../50-security-compliance/rbac-matrix.md)).
- [ ] Cross-tenant access returns **404, not 403**.
- [ ] No endpoint accepts a tenant identifier from the client.
- [ ] Session invalidation still correct on role change.
- [ ] **Security review by a second pass**, on a separate day if there is no second person.

## If it changes a documented decision

- [ ] **ADR written first**, and the affected document references it. Architecture and compliance documents change by ADR, not by silent edit ([docs/README.md](../README.md)).
- [ ] [Compliance Responsibility Matrix](../50-security-compliance/compliance-responsibility-matrix.md) updated if the regulatory position moves.

## Before a release

- [ ] Verified in staging on the critical paths: book → pay → consult → prescribe → dispense → deliver.
- [ ] Release notes written in plain language for clinics, readable in thirty seconds.
- [ ] Anything workflow-changing has been announced in advance.
- [ ] Deploy scheduled outside Ugandan clinic hours, with someone watching.

## The three questions

Before merging anything substantial, check it against the permanent boundaries ([Non-Goals](../10-product/non-goals.md)):

1. **Does this make Carevelo look like it employs clinicians?**
2. **Does this make Carevelo look like it handles drugs?**
3. **Does this make Carevelo hold anyone's money, even briefly?**

Any yes stops the change. These are legal boundaries, not preferences, and no amount of customer demand moves them.

## What is not required

Stated so nobody adds ceremony that a small team cannot sustain:

- A coverage threshold. Test what would hurt ([Test Strategy](test-strategy.md)).
- A design document for a routine change.
- Sign-off from anyone who does not exist yet.
