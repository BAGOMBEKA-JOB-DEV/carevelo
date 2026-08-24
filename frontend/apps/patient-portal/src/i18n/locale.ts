import { cookies, headers } from 'next/headers'
import { LOCALE_COOKIE, negotiateLocale, type Locale } from './locales'

/**
 * The language for this request, read from the request itself.
 *
 * THE ONE PLACE THE COOKIE AND THE HEADER ARE READ. `i18n/request.ts` hands next-intl
 * whatever this returns, so `getLocale()` anywhere in a component tree and this function
 * cannot disagree — which matters, because <html lang> comes from one path and the
 * messages from the other, and a page that says `lang="en"` while rendering Luganda text
 * tells a screen reader to pronounce Luganda with English phonology. That is not a
 * cosmetic defect for somebody who is listening rather than reading.
 *
 * No fetch, and that is deliberate rather than incidental: this is called from the ROOT
 * LAYOUT, and a fetch there is what made a single sign-in submission allocate ~800MB and
 * take the server into the OOM reaper. Cookies and headers are already-parsed request
 * state; reading them costs nothing and adds no network call. See lib/metadata.ts.
 */
export async function activeLocale(): Promise<Locale> {
  const [jar, requestHeaders] = await Promise.all([cookies(), headers()])

  return negotiateLocale(
    jar.get(LOCALE_COOKIE)?.value,
    requestHeaders.get('accept-language'),
  )
}

/**
 * The same language, shaped for an outgoing call to the Carevelo API.
 *
 * THE SERVER VALIDATES IN A LANGUAGE TOO. A patient reading the portal in Luganda who
 * mistypes their password gets the API's sentence back, and without this header that
 * sentence arrives in English inside an otherwise-Luganda screen. The API has supported
 * this from the start — `Accept-Language` selects `en` or `lg` — and the frontend simply
 * never sent it.
 *
 * Returned as a spreadable object rather than a bare string so a caller that already
 * builds a header record adds one line and cannot get the header NAME wrong:
 *
 *     ...(await acceptLanguageHeader()),
 *
 * @see docs/40-api/api-conventions.md
 */
export async function acceptLanguageHeader(): Promise<{ 'Accept-Language': Locale }> {
  return { 'Accept-Language': await activeLocale() }
}
