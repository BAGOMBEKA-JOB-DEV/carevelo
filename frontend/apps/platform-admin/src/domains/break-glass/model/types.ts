import type { components, operations } from '@carevelo/api-client'

/**
 * Every shape this domain handles, taken from the generated contract. Not one of them is
 * hand-written — a hand-written response interface is a second copy of the contract that
 * nothing checks, and it drifts the first time the API adds a field.
 */

/**
 * One grant of emergency access to a clinic's records.
 *
 * FOUR FIELDS ON THIS TYPE ARE THE CONTROL, AND A SCREEN THAT SKIPS ANY OF THEM IS LYING
 * ABOUT WHAT IS HAPPENING:
 *
 *   `reason` and `scope` — why, and over which records. Both are required at request time
 *   and both are reviewed later by somebody who was not in the room.
 *
 *   `expires_at` — the time box. A grant with no end is not a grant.
 *
 *   `tenant_notified_at` — the contract's own note: "Not decoration. An unnotified grant
 *   permits nothing, so this field is the difference between a request and a grant." The
 *   clinic is the data controller and Carevelo is its processor; it has a right to know
 *   when we read its records.
 *
 * `revoked_at` IS ON THIS TYPE AND NOTHING IN THIS APP CAN SET IT. There is no revoke
 * endpoint in the published API — grants expire, they are not revoked — so this app renders
 * the field where it is set and offers no control that would set it. See the screen.
 */
export type Grant = components['schemas']['BreakGlassGrantResource']

/** The request body, exactly as `POST /v1/platform/break-glass` accepts it. */
export type GrantRequestBody = components['schemas']['StoreBreakGlassGrantRequest']

/**
 * The closed list of scopes: which records the grant reaches.
 *
 * FROM THE CONTRACT, WHICH MEANS THE SCREEN CANNOT INVENT A NINTH. A free-text scope would
 * be unreviewable — the entire value of the field is that a reviewer months later can sort
 * grants by what was actually reached.
 */
export type GrantScope = GrantRequestBody['scope']

type GrantIndex =
  operations['v1.platform.break-glass.index']['responses'][200]['content']['application/json']

/**
 * A page of the grant register.
 *
 * CURSOR, NOT OFFSET. Grants are issued and expire while somebody reads the register, which
 * is exactly the traffic under which an offset duplicates and skips rows.
 */
export type GrantsPage = GrantIndex

export type GrantQuery = NonNullable<
  operations['v1.platform.break-glass.index']['parameters']['query']
>

/**
 * Where the route layer has mounted this domain's screen.
 *
 * PASSED IN RATHER THAN GUESSED, so a Server Action can never be talked into redirecting
 * somewhere a form told it to — which matters more here than anywhere else in this app,
 * because the action on the other end of this form authorises access to a clinic's medical
 * records.
 */
export type BreakGlassPaths = {
  /** Where `<BreakGlassScreen>` is mounted. Receives `?cursor=&requested=&problem=&message=`. */
  register: string
  /** The platform overview, for the one link back. */
  overview: string
}

/** What a request attempt did, as a code rather than a sentence. */
export type BreakGlassProblem = 'incomplete' | 'refused' | 'invalid' | 'not_found' | 'failed'
