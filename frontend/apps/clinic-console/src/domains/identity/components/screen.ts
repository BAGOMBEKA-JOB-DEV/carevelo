/**
 * The three things every screen in this domain needs and none of them should say twice.
 *
 * DELIBERATE DUPLICATION, NAMED AS SUCH. `domains/tenant/components/screen.ts` has
 * `SearchValue`, `first()`, `samePath()` and `withParams()` in almost these words. They
 * cannot be shared: `no-cross-domain-internals` forbids reaching into that domain, its
 * `index.ts` exports none of them — correctly, they are its internals — and
 * `packages/ui` is domain-agnostic by charter. The honest fix is `src/lib`, which this
 * piece of work does not own; it is named in the report rather than done quietly here.
 *
 * NO next-intl, DELIBERATELY. Only the patient portal is required to be bilingual
 * (`docs/30-architecture/frontend-nextjs.md` §210). The staff surfaces are English and
 * plain strings are the correct choice; a translation layer here would be work with no
 * reader.
 */

/**
 * A search parameter as Next actually hands it over.
 *
 * The screens take this shape rather than `string` so the routes stay genuinely thin: a
 * route that narrowed it would be holding logic, and a route that TYPED it as `string`
 * would be asserting something the runtime does not guarantee — `?error=a&error=b` is a
 * perfectly legal URL and produces an array. A screen that assumed `string` renders
 * `[object Object]` the first time somebody repeats the key in the address bar, and this
 * is the sign-in screen, which is the worst possible place to look broken.
 */
export type SearchValue = string | string[] | undefined

/** One value from a search parameter, whatever shape Next handed over. */
export function first(value: SearchValue): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * One text field from a native form post.
 *
 * `FormData.get()` returns `File | string | null`, and a screen that assumed `string` would
 * put a `File` object's `toString()` into a password comparison the first time somebody
 * pointed a file input at a field of that name. Anything that is not a string is `null`,
 * which every caller here already handles because a field can legitimately be absent.
 */
export function text(formData: FormData, name: string): string | null {
  const value = formData.get(name)

  return typeof value === 'string' ? value : null
}

/**
 * A path on this origin, or the fallback.
 *
 * `redirect()` will happily send somebody to another origin, and an open redirect on a
 * SIGN-IN screen is a credential-harvesting page reachable from a link that genuinely
 * begins with the clinic's own address. Every path in this domain arrives as an encrypted
 * bound argument — so it cannot be edited in the page — and is checked here anyway,
 * because a control that costs one line is worth having twice.
 *
 * `//evil.example` is a protocol-relative URL and a browser follows it off-site, so the
 * double slash is refused explicitly rather than left to the leading-slash test.
 */
export function samePath(candidate: string, fallback: string): string {
  return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : fallback
}

/**
 * The same path, carrying what the action has to say back.
 *
 * A Server Action ends in `redirect()` and a redirect cannot carry a value to the screen it
 * came from. The alternative is `useActionState`, which makes the form a client component —
 * and these forms must post NATIVELY, before any bundle arrives and with JavaScript
 * switched off entirely. So the outcome travels as an ordinary search parameter.
 *
 * A `null` value removes the key, which is what makes a fresh arrival clear the failure
 * that sent somebody back here.
 */
export function withParams(
  path: string,
  params: Readonly<Record<string, string | null>>,
): string {
  // The origin is a placeholder that never leaves this function: `URL` needs a base to
  // parse a relative path, and only the path and query are read back out.
  const url = new URL(path, 'https://console.invalid')

  for (const [key, value] of Object.entries(params)) {
    url.searchParams.delete(key)

    if (value !== null) {
      url.searchParams.set(key, value)
    }
  }

  return `${url.pathname}${url.search}`
}
