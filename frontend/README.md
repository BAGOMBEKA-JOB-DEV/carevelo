# Carevelo frontend

Four surfaces, one pnpm workspace. Everything here talks to the Laravel API over HTTP
and to Reverb over an authenticated WebSocket. **Nothing here talks to a database, and
nothing here is PHP** — the boundary is absolute in both directions
([ADR-0007](../docs/70-decisions/0007-separate-backend-frontend-trees.md)), and CI fails
the build if PHP appears under this tree.

```
apps/
  patient-portal/    clinic-branded, server-rendered, strict weight budget
  clinic-console/    staff — schedule, consultations, pharmacy, dispatch, admin
  rider-view/        assigned deliveries only. No clinical data can exist here
  platform-admin/    Carevelo staff
packages/
  ui/                design tokens and cross-app components
  api-client/        GENERATED from docs/40-api/openapi.yaml — committed
  realtime/          the only place Laravel Echo is imported
```

## Why four apps

Three are named in [frontend-nextjs.md](../docs/30-architecture/frontend-nextjs.md); the
fourth is `rider-view`, and it follows that document's own argument for splitting the
patient portal out — *"bundling it with a heavy staff console penalises exactly the user
who can least afford it."* A rider on a phone is in the same position.

It also mirrors the backend, where `RiderDeliveryResource` is a separate resource class
rather than the dispatcher's with fields hidden. The frontend equivalent of that is a
separate app, not hidden routes: the least-trusted actor's bundle should not be *able* to
contain a prescribing form.

## Domains, not file types

Inside every app, code is organised by domain. A domain owns its components, hooks, API
calls and types together, and exposes exactly one public surface.

```
apps/<app>/src/
  app/                 Next.js routes ONLY — thin, composes domains, holds no logic
  domains/<domain>/
    components/        used by this domain and no other
    hooks/
    api/               through @carevelo/api-client, never raw fetch
    types.ts
    index.ts           the ONLY importable entry point
  components/          app-global, domain-agnostic: shell, nav, layout
  lib/                 app-global helpers
```

The domains are taken from the section headings of
[endpoint-catalogue.md](../docs/40-api/endpoint-catalogue.md), so module boundaries follow
the documented bounded contexts rather than anyone's taste: `identity`, `tenant`,
`patients`, `scheduling`, `consultations`, `prescriptions`, `dispensing`, `delivery`,
`payments`, `notifications`, `audit`, `platform`.

**Each app carries only the domains it needs.** That is a security property, not tidiness.

### Two shared layers, deliberately

`packages/ui` holds what more than one **app** needs. `apps/<app>/src/components/` holds
what more than one **domain** inside that app needs but no other app wants — the console's
shell is not the portal's. One shared folder for both is how a shared folder becomes a junk
drawer.

### The rules

1. A domain may import from `packages/*`, `src/components/`, `src/lib/`.
2. A domain may **not** reach into another domain's internals — only its `index.ts`, and
   cross-domain composition belongs in the route layer.
3. `src/components/` and `packages/ui` may **not** import from any domain. The dependency
   direction is one-way. A shared component that knows about appointments is not shared.
4. No app imports from another app.
5. `app/` routes hold no business logic.

Enforced by `pnpm boundaries` (dependency-cruiser) in CI, not by this README. A boundary
that lives only in documentation erodes on a deadline.

## The API client is generated and committed

`packages/api-client` is generated from `docs/40-api/openapi.yaml` and **committed**, so
this tree builds with no knowledge that `backend/` exists. The contract is a document both
sides read, not a dependency one has on the other.

Changing the API means regenerating and committing the client in the same change. Two CI
gates enforce it: the backend's `api:contract --check` proves the YAML matches the routes,
and `pnpm api-client:check` proves the committed client matches the YAML.

## Commands

```
pnpm install
pnpm check          # typecheck, lint, boundaries, client freshness, build
pnpm boundaries     # the import rules above
```
