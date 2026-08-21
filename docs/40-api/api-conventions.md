# API Conventions

> **Status:** Draft
> **Last reviewed:** 2026-08-13
> **Derives from:** [Ubiquitous Language](../20-domain/ubiquitous-language.md), [Identifiers](../20-domain/identifiers-and-numbering.md)

One REST API serving all three frontends. JSON in, JSON out.

## The API is the only contract

`backend/` and `frontend/` share nothing but this API and authenticated WebSocket frames ([ADR-0007](../70-decisions/0007-separate-backend-frontend-trees.md)). Three consequences that shape the design:

**No endpoint exists solely to serve a frontend rendering concern.** An endpoint shaped around one screen's layout couples the backend to a UI that is supposed to be replaceable. Endpoints expose domain resources; assembling a screen from them is the frontend's job.

**[openapi.yaml](openapi.yaml) is the published contract**, not documentation of one. `frontend/packages/api-client` is generated from it and committed, and a CI gate fails if the two drift ([Frontend](../30-architecture/frontend-nextjs.md)). **Changing the API means regenerating and committing the client in the same change.**

**The backend is authoritative on every rule.** The frontend may validate to give a fast, friendly error; it may never be the only place a rule is enforced.

### Cross-origin

The frontends are served from different hosts to the API, so requests are **credentialed cross-origin**: `Access-Control-Allow-Credentials: true`, an explicit per-tenant origin allow-list (never `*`, which is incompatible with credentials anyway), and cookies scoped to the parent domain so a tenant subdomain can authenticate against the API host.

Preflight responses are cached, and the allow-list is derived from the tenant register — an unknown origin is rejected without revealing whether the tenant exists ([Multi-Tenancy](../30-architecture/multi-tenancy.md)).

## Versioning

Path-based: `/v1/appointments`. Blunt, obvious, and trivially cacheable and routable — which matters more than elegance when the audience is three first-party clients.

Within a version, only additive change: new optional fields, new endpoints, new enum values that clients must tolerate. Removing a field, changing a type, tightening validation or changing a default is a new version.

A superseded version is supported for at least six months after its successor ships.

## Paths and naming

`kebab-case`, plural nouns, `snake_case` JSON fields ([Ubiquitous Language](../20-domain/ubiquitous-language.md)):

```
GET    /v1/dispense-orders
GET    /v1/dispense-orders/{id}
POST   /v1/dispense-orders/{id}/dispense
```

State transitions are **named sub-resource actions**, not a PATCH of a status field. `POST .../dispense` expresses a domain operation with its own preconditions and authorisation; `PATCH {"status": "dispensed"}` invites a client to invent a transition the state machine forbids ([State Machines](../20-domain/state-machines.md)).

Verbs in paths are acceptable and preferred for these actions. Purity is not the goal; a safe, legible API is.

## Tenant scoping

**`tenant_id` never appears in a path, a query parameter, a header or a body.**

Tenant identity is resolved from the host or the authenticated session ([Multi-Tenancy](../30-architecture/multi-tenancy.md)). A client-supplied tenant ID would be a client-controlled authorisation decision, which is the whole vulnerability class we designed the database layer to defeat.

Responses omit `tenant_id` — the client is already within exactly one tenant and cannot be anywhere else.

## Requests

```http
POST /v1/payment-intents HTTP/1.1
Host: brightcare.carevelo.app
Authorization: Bearer {token}
Content-Type: application/json
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Accept-Language: en
```

- `Idempotency-Key` is **required on every mutating payment request** and accepted on all mutating requests (see below).
- `Accept-Language` selects `en` or `lg`.
- Unknown fields in a body are **rejected**, not ignored. A typo'd field name silently discarded is how a clinic discovers six weeks later that a price was never saved.

## Responses

Single resource:

```json
{
  "data": {
    "id": "01J8XK2P9QR3M4N5T6V7W8Y9Z0",
    "reference": "APT-2608-0147",
    "status": "confirmed",
    "scheduled_start_at": "2026-08-14T09:00:00Z",
    "created_at": "2026-08-13T14:22:01Z"
  }
}
```

Collection:

```json
{
  "data": [ ... ],
  "meta": { "per_page": 25, "has_more": true, "next_cursor": "eyJpZCI6..." }
}
```

Rules: always a `data` envelope; timestamps ISO 8601 UTC with `Z`; IDs are ULIDs; money as `{"amount_minor": 15000000, "currency": "UGX"}` and **never a float**; enums lowercase `snake_case` matching the domain exactly.

**Responses carry only what the caller is entitled to see.** The rider serialisation of a delivery is a different resource class from the dispatcher's, not the same class with fields hidden in the UI ([H4](../10-product/prd-h4-prescription-dispensing-delivery.md), [Data Protection](../50-security-compliance/data-protection-dppa.md)).

## Pagination

**Cursor-based**, default 25, maximum 100. Cursors are opaque.

Offset pagination is unstable when rows are inserted during traversal — a pharmacy queue that a pharmacist pages through while orders arrive will show duplicates and skip items with offsets, which in that context means a missed order.

## Errors

RFC 9457 problem details:

```json
{
  "type": "https://docs.carevelo.app/errors/pending-substitution",
  "title": "Cannot dispense while a substitution is pending",
  "status": 409,
  "detail": "Item 2 has a substitution awaiting clinician approval.",
  "instance": "/v1/dispense-orders/01J8XK.../dispense",
  "code": "pending_substitution"
}
```

Validation errors add per-field messages:

```json
{
  "type": "https://docs.carevelo.app/errors/validation",
  "title": "The request is invalid",
  "status": 422,
  "code": "validation_failed",
  "errors": {
    "phone": ["Enter a valid Ugandan phone number."],
    "scheduled_start_at": ["This slot is no longer available."]
  }
}
```

| Status | Use |
|---|---|
| 400 | Malformed request; no tenant resolved |
| 401 | Missing or invalid authentication |
| 403 | Authenticated but not permitted; tenant mismatch |
| 404 | Not found, **or not visible to this caller** |
| 409 | Conflict: illegal state transition, idempotency key reuse with a different body |
| 422 | Validation failed |
| 429 | Rate limited |
| 500 | Our fault |
| 503 | Dependency unavailable |

**403 versus 404:** a resource in another tenant returns **404**, not 403. A 403 confirms the resource exists, which leaks that a given patient or reference belongs to some other clinic. With RLS in place this happens naturally — the row simply is not there.

`title` and `detail` are written for humans and shown to users; a clinic administrator reading a raw validation payload is a support call. `code` is stable and machine-readable; `title` may be reworded.

**Aggregator errors are surfaced verbatim.** Only the aggregator knows why a mobile-money collection failed, and paraphrasing loses the part the patient can act on ([H5](../10-product/prd-h5-payments-non-custodial.md)).

Error responses never contain clinical content, personal identifiers beyond what the caller already supplied, or any internal detail — no stack traces, no SQL, no class names.

## Idempotency

The mechanism that prevents a patient paying twice ([Identifiers](../20-domain/identifiers-and-numbering.md)). It is the highest-consequence convention in this document.

**Client:** generate a UUIDv4 and **reuse it across retries of the same logical operation**. A deliberate new attempt by the user — pressing "pay" again after a visible failure — gets a new key.

**Server:**

| Situation | Behaviour |
|---|---|
| New key | Process; store the response against the key |
| Same key, same body | Return the stored response. **Do not re-execute** |
| Same key, different body | `409 Conflict`. This is a client bug, and silently processing it is how money goes missing |
| Same key, original still in flight | `409 Conflict` with a retry hint |

Keys are scoped `(tenant_id, idempotency_key)` and retained 24 hours — comfortably longer than any mobile-money resolution window.

## Rate limiting

Per tenant and per actor, with `429` and a `Retry-After` header.

| Endpoint class | Limit |
|---|---|
| Authentication and password change | Strict, per identifier — phone number or email address — and per IP |
| Payment initiation | Moderate, per patient |
| Read endpoints | Generous |
| Webhooks | Per tenant, generous, with signature verification first |

Per-tenant limits contain the blast radius of one clinic's runaway integration — the noisy-neighbour problem is real in a shared deployment.

## Filtering and sorting

```
GET /v1/appointments?status=confirmed&from=2026-08-13&to=2026-08-20&sort=-scheduled_start_at
```

Explicit allow-lists for filterable and sortable fields. Never build a query from arbitrary client input — that is SQL injection wearing a REST costume, and an unindexed sort on a shared database is a denial of service.

## Timezones

Stored and transmitted in UTC. Displayed in `Africa/Kampala`. Never transmit a local time without an offset.

## Deprecation

A deprecated endpoint returns `Deprecation` and `Sunset` headers and is logged with the calling client so we know who still depends on it before removing it.

## Acceptance criteria

1. No endpoint accepts a tenant identifier from the client.
2. Cross-tenant resources return 404, never 403.
3. Unknown request fields are rejected.
4. Every mutating payment endpoint requires `Idempotency-Key`; replay returns the stored response; a differing body returns 409.
5. Money is never serialised as a float.
6. Error responses contain no clinical content, stack trace or internal detail.
7. Rider-facing serialisations are distinct resource classes carrying no clinical fields.
8. Filter and sort parameters are allow-listed.
