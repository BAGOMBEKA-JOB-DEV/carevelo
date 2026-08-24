import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The session calls, driven the way the browser drives them.
 *
 * This is the only piece of real plumbing in the portal — cookie forwarding, CSRF and
 * the mapping from an API failure to a sentence — and every defect it has had so far
 * was invisible to the type checker, to the linter and to the boundary rules. They were
 * all found by driving the endpoint: the wrong field names on the password change, the
 * status that is 204 and not 200, the subdomain that disappears on an action-redirect
 * render. So the tests below are written against the WIRE: what leaves this module as an
 * HTTP request, and what it puts back in the cookie jar. Nothing here asserts that a
 * function was called.
 *
 * WHY MOCK fetch RATHER THAN THE MODULE. The one mechanism that matters is the round
 * trip — a Set-Cookie arriving on the API's response and coming back out on the portal's
 * own. Mock this module's own helpers and that round trip is exactly the part not under
 * test. So `fetch` is stubbed with real `Response` objects, which carry real `Headers`
 * with a real `getSetCookie()`, and `next/headers` is stubbed with a cookie jar that
 * actually stores what it is given. Everything between those two is the code under test.
 *
 * THE ENUMERATION TEST IS NOT DECORATION. The API answers "no account for that address"
 * and "wrong password" with the same status and the same sentence, so that nobody can
 * confirm who is a patient at a named clinic by typing addresses at a public form. A
 * test that only asserted "an error message is shown" would let someone add a helpful
 * "check your email address" refinement and stay green. The test below asserts the two
 * StepResults are IDENTICAL, which is the property that actually protects the patient.
 *
 * @see docs/40-api/authentication-and-sessions.md
 */

const request = vi.hoisted(() => {
  interface StoredCookie {
    name: string
    value: string
    httpOnly: boolean
  }

  const cookies = new Map<string, StoredCookie>()

  return {
    /** What the Host header says. */
    host: 'kira.localhost:3000',
    /**
     * What x-forwarded-host says, when anything does. Kept separate because the two
     * disagree on exactly one render and that disagreement was a real 404 — see the
     * test for it below.
     */
    forwardedHost: undefined as string | undefined,
    cookies,
    /*
     * Enough of Next's cookies() to be honest. It stores, so a test can assert that a
     * cookie the API issued genuinely landed rather than that a setter was called.
     */
    jar: {
      getAll: (): StoredCookie[] => [...cookies.values()],
      get: (name: string): StoredCookie | undefined => cookies.get(name),
      set: (options: { name: string; value: string; httpOnly?: boolean }): void => {
        cookies.set(options.name, {
          name: options.name,
          value: options.value,
          httpOnly: options.httpOnly ?? false,
        })
      },
      delete: (name: string): void => void cookies.delete(name),
    },
  }
})

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve(request.jar),
  headers: () => {
    const requestHeaders = new Headers({ host: request.host })

    if (request.forwardedHost !== undefined) {
      requestHeaders.set('x-forwarded-host', request.forwardedHost)
    }

    return Promise.resolve(requestHeaders)
  },
}))

/*
 * lib/tenant imports notFound() for resolveTenant(), which nothing here calls. Stubbed
 * so that if a session call ever grows a path into it, this fails loudly rather than
 * rendering a 404 at a patient who typed their password correctly.
 */
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('notFound() must not be reachable from a session call')
  },
}))

import { changePassword, signInWithPassword, signOut } from './session'

/** The sentence the API sends for both "no such account" and "wrong password". */
const REFUSAL = 'Those details do not match an account at this clinic.'

interface RecordedCall {
  url: string
  init: RequestInit
}

let calls: RecordedCall[] = []

/**
 * Build a real Response, so the code under test reads real headers.
 *
 * `getSetCookie()` is the only way to read more than one Set-Cookie off a response, and
 * a sign-in returns two — the session and a rotated CSRF token. A hand-rolled fake would
 * have let a single-header bug through.
 */
function apiResponse(options: {
  status: number
  body?: unknown
  setCookie?: string[]
}): Response {
  const headers = new Headers()

  for (const cookie of options.setCookie ?? []) {
    headers.append('set-cookie', cookie)
  }

  if (options.body !== undefined) {
    headers.set('content-type', 'application/problem+json')
  }

  // 204 is a null-body status and Response refuses to carry one, which is itself worth
  // knowing: the password change answers 204, so anything that assumed a JSON body there
  // was assuming something the HTTP layer will not allow.
  const body =
    options.status === 204 || options.body === undefined
      ? null
      : JSON.stringify(options.body)

  return new Response(body, { status: options.status, headers })
}

/**
 * Answer the API's routes, and record every request for inspection.
 *
 * Keyed by path rather than by call order because each public function makes TWO
 * requests — the CSRF cookie, then the real one — and a test that has to count them is a
 * test that breaks when someone adds a third.
 */
function stubApi(routes: Record<string, () => Response>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)

      calls.push({ url, init: init ?? {} })

      const match = Object.keys(routes).find((path) => url.endsWith(path))

      if (!match) {
        throw new Error(`No stub for ${url}. Routes: ${Object.keys(routes).join(', ')}`)
      }

      return Promise.resolve(routes[match]!())
    }),
  )
}

/** The request this module actually put on the wire, decoded. */
function sentTo(path: string): {
  url: string
  headers: Headers
  body: Record<string, unknown> | undefined
} {
  const call = calls.find((recorded) => recorded.url.endsWith(path))

  if (!call) {
    throw new Error(`Nothing was sent to ${path}. Sent: ${calls.map((c) => c.url).join(', ')}`)
  }

  return {
    url: call.url,
    headers: new Headers(call.init.headers as HeadersInit),
    body:
      call.init.body === undefined
        ? undefined
        : (JSON.parse(String(call.init.body)) as Record<string, unknown>),
  }
}

const CSRF = '/sanctum/csrf-cookie'
const SIGN_IN = '/v1/auth/sign-in'
const SIGN_OUT = '/v1/auth/sign-out'
const PASSWORD = '/v1/me/password'

/*
 * Laravel URL-ENCODES the XSRF-TOKEN cookie value, and expects the DECODED value back in
 * the header. The `%3D` padding below is not decoration — it is the difference between a
 * sign-in that works and a 419 that looks like a session problem.
 */
const csrfIssued = (token = 'v4l1d%3D%3D'): Response =>
  apiResponse({
    status: 204,
    setCookie: [`XSRF-TOKEN=${token}; Path=/; SameSite=Lax`],
  })

beforeEach(() => {
  calls = []
  request.cookies.clear()
  request.host = 'kira.localhost:3000'
  request.forwardedHost = undefined
  // Locally the portal and the API differ by port. Stubbed explicitly rather than left
  // to whatever .env.local happens to hold, so the suite says the same thing everywhere.
  vi.stubEnv('NEXT_PUBLIC_API_ORIGIN', 'http://localhost:8000')
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('signInWithPassword', () => {
  it("re-issues the API's session cookie on the portal's own response", async () => {
    /*
     * THE MECHANISM, AND THE REASON THIS FILE EXISTS.
     *
     * The portal is a separate server from the API, so a server-side call to
     * /auth/sign-in receives Set-Cookie in the Node process and the browser never sees
     * it. Drop this forwarding and every visible symptom points somewhere else: the
     * sign-in succeeds, the redirect happens, and the patient lands on /account as a
     * guest. Nothing logs an error. Nothing fails a type check.
     */
    stubApi({
      [CSRF]: () => csrfIssued(),
      [SIGN_IN]: () =>
        apiResponse({
          status: 200,
          body: { data: { id: 'usr_1' } },
          setCookie: [
            'carevelo_session=eyJpdiI6InNlc3Npb24ifQ%3D%3D; Path=/; HttpOnly; SameSite=Lax',
            'XSRF-TOKEN=r0t4t3d%3D; Path=/; SameSite=Lax',
          ],
        }),
    })

    const result = await signInWithPassword('email', 'aisha@example.test', 'correct horse')

    expect(result).toEqual({ ok: true })
    expect(request.jar.get('carevelo_session')).toEqual({
      name: 'carevelo_session',
      // Percent-decoded, because that is what the browser will send back.
      value: 'eyJpdiI6InNlc3Npb24ifQ==',
      // HttpOnly is read off the API's own attributes rather than assumed: a session
      // cookie readable from JavaScript on a page that renders health data is the whole
      // reason this product does not use bearer tokens in storage.
      httpOnly: true,
    })

    // BOTH cookies, not just the first. The rotated CSRF token arrives on the same
    // response, and a browser holding the pre-sign-in one gets a 419 on its next write.
    expect(request.jar.get('XSRF-TOKEN')?.value).toBe('r0t4t3d=')
  })

  it('sends the CSRF token it was just issued, percent-decoded', async () => {
    stubApi({
      [CSRF]: () => csrfIssued('t0k3n%3D%3D'),
      [SIGN_IN]: () => apiResponse({ status: 200 }),
    })

    await signInWithPassword('email', 'aisha@example.test', 'correct horse')

    // Laravel compares the header against the DECODED cookie. Forwarding the raw
    // percent-encoded value is a 419 on every unsafe request, which reads as an expired
    // session rather than as an encoding bug.
    expect(sentTo(SIGN_IN).headers.get('X-XSRF-TOKEN')).toBe('t0k3n==')
    expect(sentTo(CSRF).url).toContain('/sanctum/csrf-cookie')
  })

  it("forwards the browser's existing cookies to the API", async () => {
    request.jar.set({ name: 'carevelo_session', value: 'already-signed-in' })
    request.jar.set({ name: 'carevelo_theme', value: 'dark' })

    stubApi({
      [CSRF]: () => csrfIssued(),
      [SIGN_IN]: () => apiResponse({ status: 200 }),
    })

    await signInWithPassword('email', 'aisha@example.test', 'correct horse')

    const cookieHeader = sentTo(SIGN_IN).headers.get('Cookie') ?? ''

    expect(cookieHeader).toContain('carevelo_session=already-signed-in')
    expect(cookieHeader).toContain('carevelo_theme=dark')
  })

  it('sends an Origin, without which Sanctum never starts a session', async () => {
    stubApi({
      [CSRF]: () => csrfIssued(),
      [SIGN_IN]: () => apiResponse({ status: 200 }),
    })

    await signInWithPassword('email', 'aisha@example.test', 'correct horse')

    // The header that makes the whole flow stateful. Without it the API does not treat
    // the caller as its own frontend and answers without a session cookie at all — which
    // presents as a sign-in that succeeds and leaves the patient a guest.
    expect(sentTo(SIGN_IN).headers.get('Origin')).toBe('http://kira.localhost:3000')
  })

  it('sends exactly one identifier, and it is the one the caller chose', async () => {
    stubApi({
      [CSRF]: () => csrfIssued(),
      [SIGN_IN]: () => apiResponse({ status: 200 }),
    })

    await signInWithPassword('phone', '+256700000000', 'correct horse')

    const body = sentTo(SIGN_IN).body

    // The API rejects both-at-once rather than silently preferring one, so sending a
    // stray empty `email` alongside the phone is a 422 on a correct sign-in.
    expect(Object.keys(body ?? {}).sort()).toEqual(['password', 'phone'])
    expect(body?.['phone']).toBe('+256700000000')
  })

  it("passes the API's sentence through unchanged", async () => {
    stubApi({
      [CSRF]: () => csrfIssued(),
      [SIGN_IN]: () =>
        apiResponse({
          status: 422,
          body: { status: 422, title: 'Unprocessable', errors: { email: [REFUSAL] } },
        }),
    })

    const result = await signInWithPassword('email', 'aisha@example.test', 'wrong')

    expect(result.ok).toBe(false)
    // Byte for byte. The API author chose this wording precisely because it says nothing
    // about which half was wrong; anything rewritten here is a second opinion on a
    // security property that is not ours to hold.
    expect(result.message).toBe(REFUSAL)
    expect(result.fieldErrors).toEqual({ email: REFUSAL })
  })

  it('answers an unknown address and a wrong password identically', async () => {
    /*
     * ENUMERATION. If these two ever diverge — a different message, a different status
     * reaching the caller, a field error on one and not the other — then anyone who can
     * type at the public sign-in form can ask "is this person a patient at this named
     * clinic" and get an answer. That is a health disclosure made without anyone reading
     * a record.
     *
     * The API is the control; this asserts the portal does not undo it.
     */
    const identical = {
      status: 422,
      body: { status: 422, errors: { email: [REFUSAL] } },
    }

    stubApi({ [CSRF]: () => csrfIssued(), [SIGN_IN]: () => apiResponse(identical) })
    const noSuchAccount = await signInWithPassword('email', 'nobody@example.test', 'x')

    calls = []
    request.cookies.clear()

    stubApi({ [CSRF]: () => csrfIssued(), [SIGN_IN]: () => apiResponse(identical) })
    const wrongPassword = await signInWithPassword('email', 'aisha@example.test', 'x')

    expect(noSuchAccount).toEqual(wrongPassword)
    expect(noSuchAccount.message).toBe(REFUSAL)
  })

  it('re-issues cookies even when the sign-in is refused', async () => {
    // The CSRF token rotates on a failed attempt too. Forwarding only on success means
    // the patient's second, correct attempt is a 419 — so they see "your session has
    // expired" after typing the right password, and try again into the same wall.
    stubApi({
      [CSRF]: () => csrfIssued('f1rst%3D'),
      [SIGN_IN]: () =>
        apiResponse({
          status: 422,
          body: { errors: { email: [REFUSAL] } },
          setCookie: ['XSRF-TOKEN=s3c0nd%3D; Path=/; SameSite=Lax'],
        }),
    })

    const result = await signInWithPassword('email', 'aisha@example.test', 'wrong')

    expect(result.ok).toBe(false)
    expect(request.jar.get('XSRF-TOKEN')?.value).toBe('s3c0nd=')
  })

  it("keeps the clinic's subdomain when swapping in the local API origin", async () => {
    stubApi({
      [CSRF]: () => csrfIssued(),
      [SIGN_IN]: () => apiResponse({ status: 200 }),
    })

    await signInWithPassword('email', 'aisha@example.test', 'correct horse')

    // Tenancy is resolved from the host. Swap the whole origin and the request arrives at
    // the API with no clinic on it — which resolves to the wrong tenant or to none, and
    // the patient is told their details are wrong.
    expect(sentTo(SIGN_IN).url).toBe('http://kira.localhost:8000/api/v1/auth/sign-in')
  })

  it("stays on the request's own host when no API origin is configured", async () => {
    // Production: the portal and the API share the host, so there is nothing to swap and
    // the scheme is https. This is the branch that runs for every real patient.
    vi.stubEnv('NEXT_PUBLIC_API_ORIGIN', undefined)
    request.host = 'kira.carevelo.app'
    request.forwardedHost = 'kira.carevelo.app'

    stubApi({
      [CSRF]: () => csrfIssued(),
      [SIGN_IN]: () => apiResponse({ status: 200 }),
    })

    await signInWithPassword('email', 'aisha@example.test', 'correct horse')

    expect(sentTo(SIGN_IN).url).toBe('https://kira.carevelo.app/api/v1/auth/sign-in')
  })

  it('finds the clinic on the render where the Host header has lost it', async () => {
    /*
     * MEASURED, NOT THEORISED. On the render Next performs when a Server Action calls
     * redirect() — which is precisely the render that follows a successful sign-in —
     * `host` degrades from `kira.localhost:3000` to `localhost:3000`. The subdomain, the
     * entire basis of tenancy, is gone, and x-forwarded-host is the only header that
     * still carries it.
     *
     * The symptom was a patient signing in correctly and landing on a 404.
     */
    request.host = 'localhost:3000'
    request.forwardedHost = 'kira.localhost:3000'

    stubApi({
      [CSRF]: () => csrfIssued(),
      [SIGN_IN]: () => apiResponse({ status: 200 }),
    })

    await signInWithPassword('email', 'aisha@example.test', 'correct horse')

    expect(sentTo(SIGN_IN).url).toBe('http://kira.localhost:8000/api/v1/auth/sign-in')
    expect(sentTo(SIGN_IN).headers.get('Origin')).toBe('http://kira.localhost:3000')
  })
})

describe('changePassword', () => {
  it("posts Laravel's field names, and no new_password anywhere", async () => {
    /*
     * A REAL BUG, FOUND ONLY BY DRIVING THE ENDPOINT. This call was briefed as
     * `new_password` / `new_password_confirmation`, which the API answered with "the
     * password field is required" — a validation error naming a field the portal was not
     * sending, on a screen a patient cannot skip. Both halves compiled. Both halves were
     * internally consistent. They just did not agree with each other.
     *
     * `confirmed` in Laravel looks for `<field>_confirmation`, so the names are not a
     * preference and the negative assertion below is the one that matters.
     */
    stubApi({
      [CSRF]: () => csrfIssued(),
      [PASSWORD]: () => apiResponse({ status: 204 }),
    })

    const result = await changePassword('temporary-one', 'a better one', 'a better one')

    expect(result).toEqual({ ok: true })

    const body = sentTo(PASSWORD).body

    expect(Object.keys(body ?? {}).sort()).toEqual([
      'current_password',
      'password',
      'password_confirmation',
    ])
    expect(body).toEqual({
      current_password: 'temporary-one',
      password: 'a better one',
      password_confirmation: 'a better one',
    })
  })

  it('sends the confirmation rather than comparing it here', async () => {
    // The API is the one authority on whether two fields match. A check done only in the
    // browser is a check that is not done; a check done in both places is two rules free
    // to disagree. So a mismatch goes up and comes back as the API's own sentence.
    const mismatch = 'The password field confirmation does not match.'

    stubApi({
      [CSRF]: () => csrfIssued(),
      [PASSWORD]: () =>
        apiResponse({ status: 422, body: { errors: { password: [mismatch] } } }),
    })

    const result = await changePassword('temporary-one', 'one thing', 'another thing')

    expect(sentTo(PASSWORD).body).toMatchObject({
      password: 'one thing',
      password_confirmation: 'another thing',
    })
    expect(result.ok).toBe(false)
    expect(result.message).toBe(mismatch)
    expect(result.fieldErrors).toEqual({ password: mismatch })
  })

  it('treats 204 as success — and 200 as a contract that has changed', async () => {
    /*
     * The observed contract, pinned. The endpoint answers 204 with no body, and the first
     * version of this code checked for 200: every successful password change was reported
     * to the patient as a failure, on the one screen they are not allowed to leave.
     *
     * The 200 case below is deliberately asserted as NOT ok. Widening this to "any 2xx"
     * would make the test pass and hide the next mismatch; if the API ever starts
     * answering 200 here, that is a contract change somebody should have to look at
     * rather than something the portal quietly absorbs.
     */
    stubApi({ [CSRF]: () => csrfIssued(), [PASSWORD]: () => apiResponse({ status: 204 }) })
    await expect(changePassword('old', 'new', 'new')).resolves.toEqual({ ok: true })

    calls = []
    request.cookies.clear()

    stubApi({
      [CSRF]: () => csrfIssued(),
      [PASSWORD]: () => apiResponse({ status: 200, body: { data: { id: 'usr_1' } } }),
    })

    expect((await changePassword('old', 'new', 'new')).ok).toBe(false)
  })

  it('forwards the rotated session cookie, so success does not sign the patient out', async () => {
    // Changing a password ends every OTHER session, and the API may hand back a fresh
    // cookie for this one. Fail to forward it and the patient is signed out by their own
    // success — back at /sign-in with a password they just set and a screen that gives no
    // hint why.
    stubApi({
      [CSRF]: () => csrfIssued(),
      [PASSWORD]: () =>
        apiResponse({
          status: 204,
          setCookie: ['carevelo_session=r3fr3sh3d; Path=/; HttpOnly; SameSite=Lax'],
        }),
    })

    request.jar.set({ name: 'carevelo_session', value: 'stale', httpOnly: true })

    const result = await changePassword('old', 'new', 'new')

    expect(result.ok).toBe(true)
    expect(request.jar.get('carevelo_session')?.value).toBe('r3fr3sh3d')
  })
})

describe('signOut', () => {
  it("clears the browser's cookies even when the API refuses", async () => {
    // A patient on a borrowed handset pressing sign-out must not depend on the API's
    // response arriving. Whatever happened up there, the cookies go.
    request.jar.set({ name: 'carevelo_session', value: 'live', httpOnly: true })
    request.jar.set({ name: 'XSRF-TOKEN', value: 'live' })

    stubApi({
      [CSRF]: () => csrfIssued(),
      [SIGN_OUT]: () => apiResponse({ status: 500, body: { status: 500 } }),
    })

    await signOut()

    expect(request.jar.getAll()).toEqual([])
  })
})
