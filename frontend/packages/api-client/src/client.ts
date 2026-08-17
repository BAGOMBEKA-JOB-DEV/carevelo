import { ApiError, humanise, type Problem } from './problem'

/**
 * The one place an HTTP request to the Carevelo API is made.
 *
 * Everything else in the workspace goes through this, which is why it is so small: it
 * owns three concerns and refuses the rest.
 *
 * 1. THE SESSION COOKIE. `credentials: 'include'` on every request, because
 *    authentication is a Sanctum HTTP-only cookie and never a bearer token in
 *    storage — any script with a foothold could read a token on a page rendering
 *    health data.
 * 2. PROBLEM DETAILS TO SENTENCES. See ./problem.ts.
 * 3. THE TENANT HOST. Which is to say: it does nothing at all, on purpose. See below.
 *
 * ON TENANCY — THE IMPORTANT PART. There is no `tenantId` parameter anywhere in this
 * module, and there must never be one. The API resolves the tenant from the Host
 * header or the session and ignores any client attempt to assert it
 * (docs/30-architecture/multi-tenancy.md). A client-supplied tenant is not merely
 * redundant, it is the shape of a cross-tenant read attempt, so the client is built
 * so the value cannot be supplied by mistake.
 *
 * `baseUrl` is an origin, not a tenant selector. In the patient portal it is the
 * clinic's own subdomain because that is the host the browser is already on.
 */
export interface ClientOptions {
  /** API origin, e.g. `https://kira.carevelo.app`. No trailing slash needed. */
  baseUrl: string
  /** Forwarded on server-rendered requests so the session travels with them. */
  headers?: Record<string, string>
  /** Injected in tests; defaults to the platform fetch. */
  fetch?: typeof globalThis.fetch
}

export interface RequestOptions {
  /** Query parameters. Undefined and null values are dropped, not sent as "undefined". */
  query?: Record<string, string | number | boolean | undefined | null>
  signal?: AbortSignal
  /**
   * Required by the API on unsafe, non-idempotent writes — a payment attempt above
   * all. Two taps on a slow connection must not become two collections.
   * @see docs/40-api/api-conventions.md
   */
  idempotencyKey?: string
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export class ApiClient {
  private readonly baseUrl: string
  private readonly headers: Record<string, string>
  private readonly doFetch: typeof globalThis.fetch

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, '')
    this.headers = options.headers ?? {}
    this.doFetch = options.fetch ?? globalThis.fetch.bind(globalThis)
  }

  get<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.send<T>('GET', path, undefined, options)
  }

  post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.send<T>('POST', path, body, options)
  }

  patch<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.send<T>('PATCH', path, body, options)
  }

  put<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return this.send<T>('PUT', path, body, options)
  }

  delete<T>(path: string, options: RequestOptions = {}): Promise<T> {
    return this.send<T>('DELETE', path, undefined, options)
  }

  private async send<T>(
    method: string,
    path: string,
    body: unknown,
    options: RequestOptions,
  ): Promise<T> {
    const url = new URL(`${this.baseUrl}/api${path.startsWith('/') ? path : `/${path}`}`)

    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value))
      }
    }

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      ...this.headers,
    }

    if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
    }

    if (options.idempotencyKey && UNSAFE.has(method)) {
      headers['Idempotency-Key'] = options.idempotencyKey
    }

    const init: RequestInit = {
      method,
      headers,
      // Always. This is how the session travels; see (1) above.
      credentials: 'include',
    }

    // Assigned only when present, rather than passed as undefined:
    // exactOptionalPropertyTypes draws a distinction between "absent" and
    // "explicitly undefined", and fetch's own types only accept the former.
    if (body !== undefined) {
      init.body = JSON.stringify(body)
    }

    if (options.signal) {
      init.signal = options.signal
    }

    const response = await this.doFetch(url, init)

    if (response.status === 204) {
      return undefined as T
    }

    // A body may be absent or not be JSON — a proxy timing out, an HTML error page
    // from something in front of the API. Treat that as the status alone rather than
    // throwing a parse error that hides what happened.
    const payload: unknown = await response
      .clone()
      .json()
      .catch(() => undefined)

    if (!response.ok) {
      const problem = (payload ?? {}) as Problem

      throw new ApiError(response.status, problem, humanise(response.status, problem))
    }

    return payload as T
  }
}
