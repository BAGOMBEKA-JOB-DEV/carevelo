import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * EVERY SERVER-SIDE API CLIENT MUST SEND `Origin`. All of them, in every domain.
 *
 * ====================================================================================
 * THE DEFECT THIS EXISTS FOR, AND IT SHIPPED IN THREE DOMAINS
 * ====================================================================================
 *
 * Sanctum decides a request is STATEFUL — that it should authenticate by cookie at all —
 * from the `Origin` or `Referer` host. A server-side call that forwards the session cookie
 * but neither of those headers falls through to TOKEN authentication, finds no bearer
 * token, and is answered 401.
 *
 * The session is entirely valid. It is simply never consulted.
 *
 * Three clients did this — delivery, dispensing and prescriptions — so a patient who had
 * just signed in successfully was told "Your session has ended. Please sign in again." on
 * `/prescriptions`, `/orders` and `/deliveries`, while `/account` and `/book` worked
 * perfectly, because `lib/session.ts` and the other four domains got it right.
 *
 * WHY NOTHING CAUGHT IT. `tsc` is happy: the header block is a valid object either way.
 * ESLint has no opinion. The unit tests mock the client rather than exercising what it
 * sends. And the 60 screenshot baselines were captured against a stack where these pages
 * were not signed in, so they photographed the honest error screen and matched it exactly
 * on every later run. It took driving the running product with a real session.
 *
 * All three carried a long, confident comment about forwarding "the session cookie and the
 * clinic's Host header" — right about the intent, and forwarding two of the three headers
 * the intent requires. A comment describing a rule is not the rule.
 *
 * ====================================================================================
 * WHY IT SCANS SOURCE RATHER THAN CALLING ANYTHING
 * ====================================================================================
 *
 * Constructing each client for real would need a request context — `headers()` and
 * `cookies()` throw outside one — so the test would end up asserting against a mock, which
 * is the same blind spot that let this through. Reading the header block is crude and it
 * cannot be satisfied by a mock.
 */

const DOMAINS = join(dirname(fileURLToPath(import.meta.url)))

/** Every .ts under domains/ that builds an ApiClient. */
function clientFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry)

    if (statSync(full).isDirectory()) {
      return clientFiles(full)
    }

    if (!entry.endsWith('.ts') || entry.endsWith('.test.ts')) {
      return []
    }

    return readFileSync(full, 'utf8').includes('new ApiClient') ? [full] : []
  })
}

describe('server-side API clients', () => {
  const files = clientFiles(DOMAINS)

  it('finds the clients at all, so a rename cannot empty this suite', () => {
    // A recursive scan that silently matches nothing is a test that passes forever.
    expect(files.length).toBeGreaterThanOrEqual(5)
  })

  it.each(files.map((file) => [file.slice(DOMAINS.length + 1), file]))(
    '%s sends Origin, so Sanctum treats the cookie as a session',
    (_label, file) => {
      /*
       * ANY expression, not a particular one. This first fired against
       * payments/api/client.ts, which sets `Origin: await portalOrigin(host)` --
       * resolving the portal's real origin rather than assuming http, and better than
       * what the other six do. A guard that insisted on one spelling would have made
       * the best implementation in the repo the one that failed.
       */
      expect(readFileSync(file, 'utf8')).toMatch(/^\s*Origin:\s*\S/m)
    },
  )

  it.each(files.map((file) => [file.slice(DOMAINS.length + 1), file]))(
    '%s forwards the cookie it is authenticating with',
    (_label, file) => {
      // Origin alone marks the request stateful and authenticates nobody.
      expect(readFileSync(file, 'utf8')).toMatch(/cookie/i)
    },
  )
})
