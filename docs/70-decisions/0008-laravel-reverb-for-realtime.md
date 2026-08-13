# ADR-0008 — Laravel Reverb for realtime

> **Status:** Accepted
> **Date:** 2026-08-13
> **Derives from:** Business Plan §H4, §I; [ADR-0001](0001-laravel-nextjs-stack.md)

## Context

Several surfaces need to update without the user reloading: the **pharmacy queue** (a prescription arrives while the pharmacist is looking at the screen), the **dispatch board**, **delivery status** for a patient tracking a package, and **in-app notification** of a payment resolving or a substitution needing clinician approval.

None of this is consultation media — that is a separate concern with its own open decision ([ADR-0004](0004-video-provider-selection.md)). This is application state.

Two constraints shape the choice.

**Data residency.** Realtime frames carry tenant identifiers, patient identifiers and order references. DPPA 2019 restricts cross-border transfer without adequate safeguards, and §I recommends in-country or in-region hosting; §E lists Ugandan data residency among the four things we compete on ([Data Residency](../30-architecture/data-residency-and-hosting.md)).

**Cost at our price point.** Blended ARPU is around UGX 300,000/month (§F). A per-message or per-connection cost that scales with clinic activity is dangerous when it cannot be passed on.

## Options considered

### A. Hosted Pusher or Ably

**For:** zero operational burden, mature, global edge, generous client libraries.

**Against, decisively:** **every frame would traverse infrastructure outside Uganda.** Even under the payload rule below — identifiers and state only, never clinical content — a continuous stream of `{tenant_id, patient_id, order_id}` is personal data crossing a border, requiring safeguards, a processing agreement and disclosure, for a benefit we can obtain in-region. Per-message cost also grows with exactly the clinic activity we are trying to encourage.

### B. Polling only

**For:** no new infrastructure, no new failure mode, works everywhere.

**Against:** a pharmacist watching a queue would poll every few seconds across every open console, all day, at every clinic — wasteful on constrained mobile connections and on our own capacity, and still laggy. Polling remains the right answer for low-frequency views, and is retained as the fallback.

### C. Server-sent events

**For:** simpler than WebSockets, one-directional, works over plain HTTP.

**Against:** no first-party Laravel integration comparable to broadcasting; connection limits over HTTP/1.1 are awkward with multiple tabs; and we would build the authorisation and channel layer ourselves — which is precisely the part that must be correct.

### D. Laravel Reverb — chosen

First-party Laravel WebSocket server, self-hosted, Pusher-protocol compatible so Laravel Echo works unchanged on the client.

**For:** **frames stay in region** — the deciding argument. No per-message cost. Native integration with Laravel's broadcasting, so channel authorisation runs through the **same policies** as the REST API rather than a parallel system. Redis-backed horizontal scaling.

**Against:** a process we operate and monitor. Connection scaling is our problem. A new failure mode, and a new disclosure surface that needs its own rules.

## Decision

**Laravel Reverb, self-hosted in region**, with Redis for horizontal scaling.

Non-negotiable conditions, specified in [Realtime Broadcasting](../30-architecture/realtime-broadcasting.md):

1. **Every channel is private and tenant-prefixed.** A channel name without a tenant prefix is the same class of defect as an unprefixed cache key — a cross-tenant leak, delivered live.
2. **Channel authorisation runs the same policies as the REST API.** A channel name is not a permission.
3. **Broadcast payloads carry identifiers and state only — never clinical content.** A WebSocket frame is a disclosure surface exactly as an SMS is, and a role-scoped channel fans out to several subscribers at once.
4. **A broadcast is a hint to refresh, never authoritative.** The client re-fetches through the authorised API. This keeps the API the single source of truth, which matters most for payment state.
5. **Polling is the fallback.** Reverb being down degrades a queue to a poll; it never blocks dispensing.

## Consequences

**Accepted costs.** A process to deploy, supervise, restart on release and monitor. Connection-count capacity planning. A new attack surface — channel subscription — requiring its own tests and its own threat-model entry. Reverb's own operational learning curve, spent by a very small team (§J.3).

**Benefits.** Realtime data never leaves the region, which is both compliance and a sales claim. No per-message cost, so encouraging clinic activity does not raise our marginal cost. Authorisation reuses the policies already written and already tested — no parallel permission system to drift. Echo on the client is a solved problem.

**Forecloses.** Nothing significant. Because Echo speaks the Pusher protocol, moving to a hosted provider later is a configuration change plus a residency decision, not a rewrite.

## Revisit when

- **Concurrent connections exceed what a comfortably-sized Reverb deployment handles.** Redis-backed horizontal scaling comes first; a hosted provider only if that is exhausted, and only with the residency question reopened.
- **Operational burden exceeds the hosted alternative's cost** — measure it before concluding it, using the connection and subscription-failure metrics in [Observability](../30-architecture/observability.md).
- MoH digital-health regulations impose requirements on realtime transport specifically.

## Related

[Realtime Broadcasting](../30-architecture/realtime-broadcasting.md) · [Realtime & Video](../30-architecture/realtime-and-video.md) · [Data Residency](../30-architecture/data-residency-and-hosting.md) · [RBAC Matrix](../50-security-compliance/rbac-matrix.md) · [ADR-0004](0004-video-provider-selection.md)
