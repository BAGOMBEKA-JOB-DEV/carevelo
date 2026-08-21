import type { BreakGlassPaths } from '@/domains/break-glass'
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
 * `/audit` IS ABSENT FROM BOTH OBJECTS. It is in the nav and it is still a planned section:
 * `GET /v1/audit-events` is tenant-scoped and clinic-admin-only, and there is no
 * cross-tenant platform audit endpoint in the published contract to build it against.
 */
export const PLATFORM_PATHS: PlatformPaths = {
  overview: '/',
  register: '/tenants',
  provision: '/tenants/new',
  export: '/tenants/export',
  breakGlass: '/break-glass',
}

export const BREAK_GLASS_PATHS: BreakGlassPaths = {
  register: '/break-glass',
  overview: '/',
}
