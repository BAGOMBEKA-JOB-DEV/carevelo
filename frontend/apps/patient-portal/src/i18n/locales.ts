/**
 * Which languages this portal reads in, and how one is chosen for a request.
 *
 * TWO LANGUAGES BECAUSE THE PRODUCT PROMISED TWO. The landing page has always carried an
 * "English & Luganda" chip and a feature cell saying the consent a patient is asked to
 * give reads in both; the data protection note requires consent in "plain language, in
 * English and Luganda, on screen rather than behind a link"; and the API has been ahead of
 * us the whole time — GET /v1/consent-policies/current returns both, and Accept-Language
 * selects `en` or `lg`. The frontend was the half that could not do it.
 *
 * NO `[locale]` URL SEGMENT, AND THAT IS THE ONE REAL DECISION IN THIS FILE. The obvious
 * next-intl setup puts every route under app/[locale]/, which for this app would mean
 * every page gaining a param it does not want and the tenant — resolved from the HOST and
 * from nowhere else — sharing the URL with a second dimension of routing. The host is the
 * only thing that decides which clinic a request belongs to, and adding a path segment
 * that decides something else invites the next person to reach for the URL when they want
 * the tenant too. next-intl does not require the segment: `getRequestConfig` may return
 * any locale it likes, so the choice lives in a cookie and falls back to the browser's own
 * Accept-Language.
 *
 * WHAT WE GIVE UP BY NOT HAVING IT: a per-language URL that can be linked, indexed and
 * cached. None of the three applies here. The portal is deliberately not indexable (every
 * page exports `robots: {index: false}` — a clinic's patient portal is that clinic's
 * commercial information), every response already carries `Cache-Control: no-store` from
 * next.config.ts, and there is no shared cache in front of it that could hand one
 * patient's language to another. A cookie-selected language behind a shared cache would be
 * a genuine defect; behind `no-store` it is not.
 *
 * @see docs/30-architecture/frontend-nextjs.md — acceptance criterion 8
 * @see docs/50-security-compliance/data-protection-dppa.md
 * @see docs/40-api/api-conventions.md — Accept-Language selects `en` or `lg`
 */

/**
 * The order here is the order the switcher renders in, so English first because it is the
 * language the clinic's own staff will be configuring the portal in.
 */
export const LOCALES = ['en', 'lg'] as const

export type Locale = (typeof LOCALES)[number]

/**
 * What a request gets when it expresses no preference at all.
 *
 * English rather than Luganda, and not because it is more important: it is the language
 * every screen is authored in, so it is the only one guaranteed to be a real translation
 * rather than an English string awaiting one. See messages/lg.needs-translation.json.
 */
export const DEFAULT_LOCALE: Locale = 'en'

/**
 * Namespaced, because this cookie sits on the clinic's own host alongside the API's
 * session cookies and Laravel's XSRF-TOKEN. A bare `locale` would be one collision away
 * from a name somebody else picks.
 */
export const LOCALE_COOKIE = 'carevelo.locale'

/** A year. A language preference is not a session and should outlive one. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value)
}

/**
 * The language for this request: the patient's explicit choice, else what their browser
 * asked for, else English.
 *
 * THE COOKIE WINS OVER THE HEADER, ALWAYS. Accept-Language is a setting somebody made once
 * in an Android menu, often years ago and often not by them — a shared handset, a phone
 * sold with a locale preset. Pressing "Oluganda" in the footer is a statement about THIS
 * portal made ten seconds ago. When the two disagree the recent, deliberate one is right.
 *
 * Pure, and separate from `next/headers`, so the negotiation can be tested without a
 * request: see i18n.test.ts.
 */
export function negotiateLocale(
  cookie: string | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  if (isLocale(cookie)) {
    return cookie
  }

  return preferredFrom(acceptLanguage) ?? DEFAULT_LOCALE
}

/**
 * The best-matching language in an Accept-Language header, or null if it names none we
 * hold.
 *
 * Deliberately small rather than a full RFC 9110 negotiator. There are two languages and
 * neither has regional variants we hold separately, so the whole job is: rank by q, take
 * the first tag whose primary subtag we recognise. A dependency to do that would be a
 * dependency on the booking path's bundle budget for forty lines of parsing.
 *
 * `lg-UG` and `lg` mean the same thing to us — we have one Luganda catalogue and the
 * region cannot change which one is loaded — so only the primary subtag is compared.
 */
function preferredFrom(header: string | null | undefined): Locale | null {
  if (!header) {
    return null
  }

  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...parameters] = part.split(';')
      const quality = parameters
        .map((parameter) => parameter.trim())
        .find((parameter) => parameter.startsWith('q='))

      /*
       * A malformed q is treated as "not wanted" rather than as 1. `q=` is the only way a
       * client says "explicitly not this", and reading a value we cannot parse as maximum
       * preference gets that exactly backwards.
       */
      const weight = quality === undefined ? 1 : Number.parseFloat(quality.slice(2))

      return {
        tag: (tag ?? '').trim().toLowerCase(),
        weight: Number.isFinite(weight) ? weight : 0,
      }
    })
    .filter((entry) => entry.tag !== '' && entry.weight > 0)
    // Stable in every engine we run on, so equal weights keep the order the client wrote.
    .sort((first, second) => second.weight - first.weight)

  for (const { tag } of ranked) {
    // `*` is "anything will do", which is not a preference — it is permission to pick.
    if (tag === '*') {
      return DEFAULT_LOCALE
    }

    const primary = tag.split('-')[0]

    if (isLocale(primary)) {
      return primary
    }
  }

  return null
}
