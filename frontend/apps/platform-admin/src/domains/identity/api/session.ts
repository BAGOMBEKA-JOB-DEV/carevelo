import { readClient } from './http'
import { capabilitiesFor, platformRoles, type Access, type Operator } from '../model/roles'

/**
 * Who is signed in, and what they may do.
 *
 * ASKS THE API RATHER THAN READING THE COOKIE. The session cookie is opaque and, more to
 * the point, it is not the authority: a role change, a deactivation or a password change
 * invalidates the session server-side, and `docs/40-api/authentication-and-sessions.md`
 * requires that a revoked permission does not survive in an active session. A frontend
 * that trusted a cookie it could see would be the one place that requirement did not
 * hold. It costs one request per render on a surface with a 15-minute idle timeout, which
 * is the shortest in the product for exactly this reason.
 *
 * NEVER CACHED. `ApiClient` uses the platform fetch and Next 16 does not cache fetches by
 * default; the root layout also awaits `headers()`, which opts every route here into
 * dynamic rendering. Both of those would have to change before a cached identity could
 * appear, and a cached identity on a shared machine is one operator acting as another.
 */
export async function currentOperator(): Promise<Operator | null> {
  try {
    const client = await readClient()

    // UNWRAPPED. `MeResource` arrives nested under `data` like every other Eloquent API
    // resource. The patient portal read it flat once and every field came back undefined,
    // which rendered as a blank name rather than failing loudly.
    const response = await client.get<{ data?: Operator }>('/v1/me')

    return response.data ?? null
  } catch {
    /*
     * A 401 is the ordinary case — a guest, or a session that idled out — and it is not
     * worth a log line. Anything else (the API is down, DNS is wrong) also lands here and
     * is deliberately treated the same way: the honest thing to tell an operator who
     * cannot be identified is that they are not signed in, because from this app's point
     * of view there is no way to tell the two apart, and guessing produces a screen that
     * says "something went wrong" when the answer is "sign in".
     *
     * The distinction is not lost: `attempt()` on the screens below reports the API's own
     * sentence for every read that fails AFTER identification succeeded.
     */
    return null
  }
}

/**
 * Resolve identity and authorisation in one call, so a route does not have to remember to
 * do the second half.
 *
 * ROUTES CALL THIS AND NOTHING ELSE. Every page on this surface is behind authentication;
 * there is no public screen, and a route that fetched data before checking would be a
 * route where the check is decoration. The shape of the return value is what enforces it:
 * a route cannot reach `can` without having gone through the `kind` narrowing first.
 */
export async function authoriseOperator(): Promise<Access> {
  const operator = await currentOperator()

  if (operator === null) {
    return { kind: 'guest' }
  }

  const roles = platformRoles(operator)

  if (roles.length === 0) {
    return { kind: 'no-role', operator }
  }

  return { kind: 'operator', operator, roles, can: capabilitiesFor(operator.roles) }
}
