# @carevelo/realtime

The only place Laravel Echo is imported, and the only way this workspace names a
broadcast channel.

Two live lint rules point at this directory. `no-restricted-imports` in
`frontend/eslint.config.js` forbids `laravel-echo` and `pusher-js` everywhere and turns
itself off for `packages/realtime/**`; `realtime-only-through-the-wrapper` in
`frontend/.dependency-cruiser.cjs` says the same thing to the module graph. Neither is
decoration. **The wrapper owns channel-name construction**, and that is what makes an
unprefixed — therefore cross-tenant — channel name impossible to build by hand.

> Read [`docs/30-architecture/realtime-broadcasting.md`](../../../docs/30-architecture/realtime-broadcasting.md)
> before this. Everything here is that document, in TypeScript.

---

## The one rule you are most likely to break

**A frame is a hint to re-fetch. It is never the thing itself.**

The backend puts three or four fields on the wire — an identifier, a `reference`, a
`status`, sometimes an operational `failure_reason`. **This package throws all of them
away except the identifier.** What your callback receives is:

```ts
{ event: 'order.dispensed', subject: 'dispense_order', id: '01J8XK…' }
```

There is no `status` here and there never will be. That is not an oversight to be fixed
the first time a screen wants one; it is the design, and here is what it buys:

- **The API stays the single source of truth.** Frames drop, duplicate and replay. A
  dropped frame is supposed to cost you freshness, never correctness — which is only
  true while nothing renders from a frame.
- **Authorisation keeps running on the re-fetch.** The channel decides *who is told that
  something changed*. The API decides *what they may see*, under abilities, policies and
  row-level security. A view rendered from a payload has skipped the half that checks.
- **Payment state stays something the API said.** A client must never treat
  `payment_intent.succeeded` as proof a patient paid. The intent's state is read back
  from the API, which reconciles independently of any webhook.
- **The payload rule stays cheap to hold.** It is affordable today precisely because
  nothing downstream needs the payload. The first screen that renders from one creates
  the pressure to put one more field on the wire, and the field after that is a medicine
  name on a channel that fans out to every pharmacist signed in at the clinic.

```ts
// NO. There is no `status` on a Hint, so this does not compile — and if it did, it
// would be a screen claiming something the API has not confirmed.
refresh: (hint) => setOrderStatus(hint.status)

// YES. The hint says which record moved. The API says what it now is.
refresh: async (hint) => {
  if (hint?.subject === 'dispense_order' && hint.id) {
    return replaceOne(await api.get(`/v1/dispense-orders/${hint.id}`))
  }
  return replaceAll(await api.get('/v1/dispense-orders', { query: { status: 'pending' } }))
}
```

`hint === null` means *reconcile the whole view*. You get it on every poll tick and after
every reconnect. A screen that ignores the argument entirely and always re-fetches
everything is **correct** — just heavier. A screen that renders the hint is neither.

---

## Wiring a screen

```tsx
'use client'

import { useEffect, useState } from 'react'
import { createRealtimeClient, resolveSocketConfig, EVENTS_ON } from '@carevelo/realtime'
import type { TransportState } from '@carevelo/realtime'

// One client per app. Identity comes from what the API said about this session
// (GET /v1/me) — never from a URL, a form field, or anything else the person on the
// other side controls.
const realtime = createRealtimeClient({
  identity: { tenantId: me.tenant_id, userId: me.id },
  socket: resolveSocketConfig({
    // Written out literally: Next replaces `process.env.NEXT_PUBLIC_…` by matching the
    // text at build time, so a lookup assembled inside a shared package resolves to
    // nothing in a production bundle and the socket silently never starts.
    key: process.env.NEXT_PUBLIC_REVERB_KEY,
    host: process.env.NEXT_PUBLIC_REVERB_HOST,
    port: process.env.NEXT_PUBLIC_REVERB_PORT,
    scheme: process.env.NEXT_PUBLIC_REVERB_SCHEME,
    apiOrigin: process.env.NEXT_PUBLIC_API_ORIGIN,
  }),
})

export function PharmacyQueue({ initial }: { initial: DispenseOrder[] }) {
  const [orders, setOrders] = useState(initial)
  const [state, setState] = useState<TransportState>('connecting')

  useEffect(() => {
    const live = realtime.live({
      channel: realtime.pharmacyQueue(),
      on: EVENTS_ON['pharmacy-queue'],
      refresh: async () => setOrders(await fetchQueue()),
      onStatus: (status) => setState(status.transport),
    })

    return () => live.stop()
  }, [])

  return <QueueTable orders={orders} live={state === 'live'} />
}
```

`stop()` in the cleanup is not optional. Without it a remounting screen accumulates
subscriptions and timers.

---

## Polling is not the fallback. It is the floor.

This is a **periodic refresh that goes quiet while a socket is delivering** — not a
websocket with a fallback bolted on. Get that the wrong way round and you will write a
screen that waits for a frame that never comes.

`BROADCAST_CONNECTION=log` is still what the backend ships, so today **nothing reaches a
socket at all** and the timer is the entire mechanism. Every screen built on this package
works anyway, which is the point: *"Reverb being unavailable degrades to polling and never
blocks a clinical or dispensing action"* is an acceptance criterion, and dispensing in
particular must never block on it.

| | default | what it does |
|---|---|---|
| `pollEveryMs` | `15_000` | reconcile on a timer while there is no socket |
| `reconcileEveryMs` | `300_000` | reconcile anyway *while live*, so one dropped frame on a quiet channel does not leave a board wrong until somebody reloads |
| `refreshOnStart` | `false` | off, because a screen normally mounts having just rendered from a server-side fetch; a duplicate request on every mount of every live screen is not free for a handset on metered data |

Polling **stops while the tab is hidden** and reconciles immediately when it comes back.
A rider's battery and a patient's data bundle are not ours to spend on a screen nobody is
looking at.

---

## What you can name, and what you cannot

There is no `channel(name: string)`. There are six constructors, and the tenant is not a
parameter on any of them — the client takes it **once**, at construction, from the
session.

```ts
realtime.pharmacyQueue()          // tenant.{tenantId}.pharmacy-queue
realtime.dispatchBoard()          // tenant.{tenantId}.dispatch-board
realtime.ownUser()                // tenant.{tenantId}.user.{userId}
realtime.ownPatient()             // tenant.{tenantId}.patient.{patientId}
realtime.ownRider()               // tenant.{tenantId}.rider.{userId}
realtime.consultation(id)         // tenant.{tenantId}.consultation.{id}
```

`ownPatient()` and `ownUser()` take no argument because there is no other patient and no
other user they could mean. Every segment is validated the way
`backend/app/Broadcasting/TenantChannel.php` validates it — empty or containing a dot is
refused at construction, because an empty tenant yields `tenant..pharmacy-queue` (matched
by nothing) and a dot lets a caller smuggle in a name that authorises as one channel and
delivers as another.

A `RealtimeChannel` carries a symbol the module does not export, so an object literal that
merely *looks* like one is a compile error rather than a subscription. Without that,
`live({ channel: { kind: 'patient', name: 'tenant.other-clinic.patient.x' } })` would
type-check.

**None of this is the security boundary.** The boundary is
`backend/app/Broadcasting/TenantPrefixedChannel.php`, which compares the channel's tenant
against the *session's* tenant, audits the mismatch, and then runs the same policy the
REST endpoint runs. This package exists so nobody asks the wrong question by accident.

### Which events reach which channel

`on:` is typed to the channel. Listening on the dispatch board for
`payment_intent.succeeded` does not compile — otherwise it would be a silent no-op, a
screen waiting forever for a frame, indistinguishable from a broken socket.

| channel | events |
|---|---|
| `pharmacy-queue` | `prescription.issued`, `order.dispensed`, `substitution.decided` |
| `dispatch-board` | `delivery.assigned`, `delivery.delivered`, `delivery.failed` |
| `user` | `substitution.proposed`, `payment_intent.succeeded`, `payment_intent.failed` |
| `patient` | `order.dispensed`, `delivery.delivered`, `delivery.failed`, `payment_intent.succeeded`, `payment_intent.failed` |
| `rider` | `delivery.assigned` |
| `consultation` | *(none yet — see below)* |

Use `EVENTS_ON[kind]` rather than retyping a list and getting it subtly wrong.

---

## Authentication

The **session cookie**, against `/broadcasting/auth`, and nothing else. No token, nothing
in client storage — any script with a foothold on a page rendering health data could read
a token and could not read an HTTP-only cookie.

Note the path. `/broadcasting/auth` is on the **`web` middleware group, not under `/api`**,
so `@carevelo/api-client` cannot reach it and must not be taught to. Laravel registers it
with `PreventRequestForgery` explicitly removed, so there is no CSRF token to send and
nothing here goes looking for the `meta[name="csrf-token"]` that this product — which
serves no Blade — never renders.

Every reconnect **re-authorises every channel**. It does not resume. A reconnecting socket
drops its subscription here and takes a fresh trip through `/broadcasting/auth` on the way
back, because permissions may have changed while it was down.

A refused subscription is retried three times and then the screen simply stays on the
timer. It deliberately does **not** branch on the status: a 403 (role changed, account
deactivated) and a 500 (Reverb restarted mid-handshake) get identical treatment, because
this layer is the authority on neither. If access is genuinely gone, the very next
re-fetch says so with a problem document the screen already knows how to render — and
deciding it here would put two things in charge of what a permission is.

---

## Server rendering

Safe to import anywhere. `laravel-echo` and `pusher-js` are reached only through dynamic
`import()` behind a `typeof window` check, so a server component or a build-time prerender
never evaluates them, and `live()` returns an inert handle on the server: no timer, no
listener, no throw.

That dynamic import is also why Echo and pusher-js are not in anyone's initial bundle —
they arrive in their own chunk when a screen actually asks to go live.

---

## Configuration

Add to each app's own `.env` (Next reads `.env` from the **app** directory; a root-level
file is silently ignored):

```
NEXT_PUBLIC_REVERB_KEY=
NEXT_PUBLIC_REVERB_HOST=
NEXT_PUBLIC_REVERB_PORT=8080
NEXT_PUBLIC_REVERB_SCHEME=http
```

`resolveSocketConfig()` returns `null` when the key or host is missing, and `null` means
*poll, and do not spend a socket attempt finding out*. That is the ordinary configuration
today, not a broken one, so it is silent.

The patient portal must pass the **clinic's own subdomain** as `apiOrigin`, exactly as
`apps/patient-portal/src/lib/session.ts` does. Tenancy is resolved from the host, so an
origin that lost the subdomain resolves the wrong clinic, or none.

Two things to know when a socket first goes up in **development**, where the portal is on
`:3000` and the API on `:8000`:

- `/broadcasting/auth` will be a cross-origin request, so it needs the API's CORS
  configuration to cover `broadcasting/*` with credentials. Laravel's default only covers
  `api/*`.
- the portal's CSP (`apps/patient-portal/src/proxy.ts`) already allows `ws:`/`wss:` for
  Reverb, but `connect-src` is otherwise `'self'` — so the auth `fetch` to another port is
  blocked in development and not in production, where the API shares the host.

Neither is this package's to fix, and both look identical from the screen: a socket that
never connects. Which is to say, they look like polling — the product keeps working, and
that is exactly the property we wanted.

---

## Nothing clinical goes into a log

`console.warn` from this package carries the channel **kind** (`patient`, `rider`), never
the channel **name** — the name carries a patient or user identifier, and a browser
console is a disclosure surface like any other. Keep it that way.

---

## Known gaps

- **The consultation channel has no events.** `ConsultationChannel` authorises it
  server-side, but nothing in `backend/app/Events` broadcasts to it, so its event type is
  `never` and `on:` accepts only `[]`. When `ConsultationStarted` exists, add it to
  `RealtimeEvent`, `EVENT_CATALOGUE` and `ChannelEvents` — and the compiler will then let
  a screen listen for it, and not before. Reverb still carries no consultation *media*;
  that is a different provider decision entirely.
- **There is no test suite here yet, and that is deliberate rather than forgotten.**
  `frontend/vitest.config.ts` defines two projects (`ui`, `patient-portal`) and this
  package is in neither, and vitest is not resolvable from it — so a `*.test.ts` written
  here today would be a file nobody executes and `tsc` would fail on the import. Adding it
  means a `package.json` edit plus an install, which is a lockfile change; it is written
  down here rather than papered over. The shape most worth covering when it lands:
  `hintFrom` discarding everything but the identifier, `segment()` refusing an empty or
  dotted id, and `startLive` polling when `socket: null`.
