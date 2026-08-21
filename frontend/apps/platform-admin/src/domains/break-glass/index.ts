/**
 * The break-glass domain's PUBLIC SURFACE.
 *
 * The only route by which a Carevelo operator reaches a clinic's clinical data: requesting a
 * time-boxed grant, and the register of every grant ever issued. Everything else in this
 * folder is internal, and `.dependency-cruiser.cjs` makes reaching past this file a build
 * failure rather than a code-review note.
 *
 * ------------------------------------------------------------
 * WHY THIS IS ITS OWN DOMAIN AND NOT PART OF `platform`
 *
 * Because taking it must be a deliberate act, and a screen reached by scrolling past a
 * tenant table is not one. The separation is the same one the RBAC matrix draws: platform
 * roles reach tenant ADMINISTRATION, and this is the single arrow that crosses into tenant
 * DATA. Folding it into the register would make it look like one more administrative control
 * beside suspend and export, which is exactly the wrong impression.
 *
 * ------------------------------------------------------------
 * WHAT THE ROUTE LAYER HAS TO DO, EXACTLY
 *
 *   <BreakGlassScreen paths canRequest clinics clinicsComplete activeGrants
 *                     cursor requested problem message />
 *
 * `canRequest` is `access.can.requestBreakGlass` — BOTH platform roles have it, deliberately;
 * see identity's model/roles.ts for why support is not made to escalate first.
 *
 * `clinics` and `clinicsComplete` come from the platform domain's `listAllTenants()`, so the
 * two domains are composed in the route rather than reaching into each other. `clinics` is
 * `null` when that read FAILED, and the screen degrades to a plain identifier field rather
 * than hiding the form: this screen is used during an incident, and an incident is exactly
 * when a dependency is unwell.
 *
 * `activeGrants` comes from the platform domain's `getHealth()` — the platform-wide figure,
 * which does not depend on how anybody paged through this register. `null` when it could not
 * be read, and the screen says it is counting what is in front of it instead.
 *
 * ------------------------------------------------------------
 * THERE IS NO REVOKE, AND THAT IS REPORTED RATHER THAN WORKED AROUND
 *
 * The published API has `POST` and `GET` on `/v1/platform/break-glass` and nothing else.
 * Grants expire; the time box is the control. `BreakGlassGrantResource` carries `revoked_at`
 * and the state machine in docs/50-security-compliance/rbac-matrix.md shows a `revoked`
 * state, so the concept exists in the model with no endpoint reaching it. This domain renders
 * the field and offers no control that would set it, and the screen says so where an operator
 * would look for one.
 */

/* ---- The screen ---- */
export { BreakGlassScreen, type BreakGlassScreenProps } from './components/BreakGlassScreen'

/* ---- Reads and writes, for a route that needs a count or a link ----
   `listGrants` throws `ApiError` on failure; the screen catches for itself. `requestGrant`
   never throws — it returns an outcome. */
export { listGrants, requestGrant, type GrantOutcome } from './api/grants'

/* ---- The closed list of scopes, for anything that has to render one ---- */
export { SCOPES, isScope, scopeLabel } from './model/scopes'

/* ---- Types, all of them from the generated contract ---- */
export type {
  BreakGlassPaths,
  BreakGlassProblem,
  Grant,
  GrantQuery,
  GrantRequestBody,
  GrantScope,
  GrantsPage,
} from './model/types'
