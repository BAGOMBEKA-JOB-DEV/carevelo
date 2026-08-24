import type { AuditPaths } from '@/domains/audit'
import type { BreakGlassPaths } from '@/domains/break-glass'
import type { IdentityPaths } from '@/domains/identity'
import type { PlatformPaths } from '@/domains/platform'

/**
 * Where each domain's screens are mounted.
 *
 * THE ROUTE LAYER OWNS THE URLS AND THE DOMAINS OWN NONE OF THEM. A domain that hard-coded
 * `/tenants` could not be moved or mounted twice, and — the part that matters more — a
 * Server Action inside it could be talked into redirecting somewhere a form told it to. The
 * one thing an action must never do is take its destination from the request, and passing
 * every destination in from here is what makes that structurally impossible rather than a
 * thing each action remembers.
 *
 * THE ROUTES MUST EXIST. Each value below needs a matching file under src/app or the link
 * 404s. That is not hypothetical on this surface: the first version of this app shipped a
 * nav whose six links all pointed at routes that did not exist, and nobody noticed because
 * nothing was ever highlighted as current.
 *
 * `/tenants/export` IS A ROUTE HANDLER, NOT A PAGE, and it answers POST only. The export is
 * audited twice — once in the platform trail and once in the clinic's own — so a GET that a
 * browser prefetched or a crawler followed would write entries into a clinic's audit trail
 * that nobody asked for.
 *
 * `/sign-in` IS THE ONE PUBLIC ROUTE ON THIS SURFACE, and it is the only one that may be
 * reached without a session — every other page redirects a guest to it. `afterSignIn` is
 * where a completed sign-in lands, and it is passed in from here for the same reason every
 * other destination is: a Server Action must never take its destination from the request,
 * and the sign-in actions are the ones a form talks to before anybody is authenticated.
 *
 * `/audit` IS A REAL SCREEN NOW, AND THIS PARAGRAPH USED TO SAY THE OPPOSITE. It said the
 * section was planned because `GET /v1/audit-events` is tenant-scoped and clinic-admin-only
 * and no cross-tenant audit endpoint existed to build against. `GET
 * /v1/platform/audit-events` exists, and it publishes the projection the RBAC matrix
 * describes rather than the tenant query with the scope taken off: Carevelo's own events in
 * full, a clinic's as metadata only.
 *
 * `AUDIT_PATHS` carries `breakGlass` as well as its own route, because the audit screen has
 * to point somewhere when it says a question is out of its reach. Record-level detail is a
 * break-glass grant, and a screen that named the limit without naming the door would read
 * as a product that is simply broken.
 */
export const PLATFORM_PATHS: PlatformPaths = {
  overview: '/',
  register: '/tenants',
  provision: '/tenants/new',
  export: '/tenants/export',
  breakGlass: '/break-glass',
}

export const AUDIT_PATHS: AuditPaths = {
  register: '/audit',
  breakGlass: '/break-glass',
  overview: '/',
}

export const IDENTITY_PATHS: IdentityPaths = {
  signIn: '/sign-in',
  afterSignIn: '/',
}

export const BREAK_GLASS_PATHS: BreakGlassPaths = {
  register: '/break-glass',
  overview: '/',
}
