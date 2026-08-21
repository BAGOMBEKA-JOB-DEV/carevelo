import type { TenantPaths } from '@/domains/tenant'

/**
 * WHERE THE TENANT DOMAIN'S SCREENS ARE MOUNTED.
 *
 * The domain hard-codes no URL. Two reasons, and the second is the one that matters:
 *
 *   1. The screens can be mounted anywhere, which is what makes them reusable and what
 *      keeps the routing tree a routing tree rather than half the application.
 *   2. A Server Action can never be talked into redirecting somewhere a form field told it
 *      to. Every path in this object travels into an action as an ENCRYPTED BOUND ARGUMENT
 *      — serialised by the framework, not editable in the page — and is re-checked as a
 *      same-origin path inside the action anyway. An open redirect on a screen that handles
 *      a clinic's merchant credentials is a phishing kit with the clinic's own name on it.
 *
 * THIS FILE IS THE ONE PLACE THESE STRINGS EXIST, so a route that moves moves once. What it
 * still does not guarantee is that each one RESOLVES: `typedRoutes` is not enabled on this
 * app, so a path here without a matching directory under `src/app/settings` is a 404 the
 * compiler cannot see. Until it can, the check is `ls src/app/settings` against the values
 * below — cheap, and worth running whenever this object changes.
 */
export const TENANT_PATHS: TenantPaths = {
  hub: '/settings',
  branding: '/settings/branding',
  compliance: '/settings/compliance',
  services: '/settings/services',
  hours: '/settings/hours',
  staff: '/settings/staff',
  /** `{user}` is replaced with the colleague's id, URL-encoded, by the domain. */
  staffMember: '/settings/staff/{user}',
  payments: '/settings/payments',
}
