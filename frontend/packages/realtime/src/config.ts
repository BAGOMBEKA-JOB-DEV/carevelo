/**
 * Where Reverb is, and whether it is anywhere at all.
 *
 * THE HONEST DEFAULT IS null. The backend ships with BROADCAST_CONNECTION=log, so today
 * nothing this package subscribes to will ever receive a frame — and that is not an edge
 * case to be tolerated, it is the current experience of every screen. `resolveSocketConfig`
 * returns null when the environment does not fully describe a Reverb, and null means
 * "poll, and do not spend a socket attempt finding out". A view built on this package
 * works either way; that is the whole design.
 *
 * @see docs/30-architecture/realtime-broadcasting.md — "when Reverb is unavailable"
 * @see docs/10-product/prd-h4-prescription-dispensing-delivery.md — it never blocks dispensing
 */

/**
 * The endpoint that signs a subscription, using the SESSION COOKIE and nothing else.
 *
 * NOT under /api, which is the mistake this constant exists to stop somebody making
 * once. Laravel registers /broadcasting/auth on the `web` middleware group
 * (BroadcastManager::routes), so @carevelo/api-client — which prefixes /api to every
 * path it is given — cannot reach it and must not be taught to.
 *
 * There is no token here and nothing in client storage. Authentication is the Sanctum
 * HTTP-only cookie: any script with a foothold on a page rendering health data could
 * read a token, and could not read that cookie.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */
export const BROADCAST_AUTH_PATH = '/broadcasting/auth'

/** A fully described Reverb. Anything less is polling. */
export interface SocketConfig {
  /** REVERB_APP_KEY. Public by design — it identifies the app, it authorises nothing. */
  readonly key: string
  readonly host: string
  readonly port: number
  readonly forceTLS: boolean
  /** Absolute when the API is on another origin, relative when it shares this one. */
  readonly authEndpoint: string
}

/**
 * The raw strings an app hands over, straight from its own environment.
 *
 * The app reads `process.env.NEXT_PUBLIC_REVERB_KEY` and friends itself rather than this
 * package doing it, for two reasons. Next replaces those expressions at BUILD time by
 * matching the literal text `process.env.NEXT_PUBLIC_…`, so a lookup assembled inside a
 * shared package resolves to nothing in a production bundle and the socket silently never
 * starts. And a package that reaches into an app's environment is a package that cannot
 * be configured differently by two apps that need different things.
 */
export interface SocketEnv {
  /** NEXT_PUBLIC_REVERB_KEY */
  readonly key?: string | undefined
  /** NEXT_PUBLIC_REVERB_HOST */
  readonly host?: string | undefined
  /** NEXT_PUBLIC_REVERB_PORT */
  readonly port?: string | undefined
  /** NEXT_PUBLIC_REVERB_SCHEME — `https` or `http`. */
  readonly scheme?: string | undefined
  /**
   * NEXT_PUBLIC_API_ORIGIN, when the API is not on this origin.
   *
   * In production the API and the apps share a host and this is left unset, which yields
   * a relative auth path and therefore a same-origin request. In development the portal
   * is on :3000 and the API on :8000 — see the README for what that costs.
   *
   * The patient portal must pass the CLINIC's own subdomain here, exactly as
   * apps/patient-portal/src/lib/session.ts does: tenancy is resolved from the host, so an
   * origin that lost the subdomain resolves the wrong clinic, or none.
   */
  readonly apiOrigin?: string | undefined
}

/**
 * Turn an environment into a socket, or into the decision not to have one.
 *
 * Deliberately silent about a missing key. An unconfigured Reverb is the documented
 * degraded mode, not a misconfiguration to shout about — and this runs on every page
 * load of every app, including the three that have no Reverb in development.
 */
export function resolveSocketConfig(env: SocketEnv): SocketConfig | null {
  const key = env.key?.trim()
  const host = env.host?.trim()

  if (!key || !host) {
    return null
  }

  // `https` unless something says otherwise, so a typo degrades to the secure choice and
  // fails visibly rather than quietly opening a cleartext socket carrying patient
  // identifiers.
  const forceTLS = (env.scheme?.trim() || 'https') === 'https'
  const port = readPort(env.port, forceTLS)

  if (port === null) {
    return null
  }

  return { key, host, port, forceTLS, authEndpoint: authEndpoint(env.apiOrigin) }
}

function readPort(raw: string | undefined, forceTLS: boolean): number | null {
  const trimmed = raw?.trim()

  if (!trimmed) {
    // Laravel's own defaults: 443 behind TLS, 8080 for `reverb:start` in development.
    return forceTLS ? 443 : 8080
  }

  const port = Number(trimmed)

  // Not a soft failure. A port of NaN produces a websocket URL that cannot be explained
  // from either end, so refusing the socket entirely and polling is the kinder outcome.
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : null
}

function authEndpoint(apiOrigin: string | undefined): string {
  const origin = apiOrigin?.trim()

  if (!origin) {
    return BROADCAST_AUTH_PATH
  }

  try {
    return new URL(BROADCAST_AUTH_PATH, origin).toString()
  } catch {
    // A malformed origin falls back to same-origin rather than throwing: this runs while
    // a page is rendering, and a bad environment variable should cost freshness, not the
    // screen.
    return BROADCAST_AUTH_PATH
  }
}
