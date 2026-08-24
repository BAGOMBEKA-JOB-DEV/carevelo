import { DEFAULT_LOCALE, type Locale } from './locales'

/**
 * The language for this request.
 *
 * ONE LANGUAGE, SO NOTHING TO DECIDE — AND THIS FUNCTION IS KEPT ANYWAY, ON PURPOSE.
 * It used to read the locale cookie and the browser's Accept-Language and rank the two;
 * both inputs went with the Luganda catalogue, because a preference between one option is
 * not a preference. What is left is the SEAT the decision sits in: `i18n/request.ts` hands
 * next-intl whatever this returns, so `getLocale()` anywhere in a component tree and this
 * function cannot disagree. That matters even with a single language, because <html lang>
 * comes from one path and the messages from the other, and it will matter a great deal on
 * the day a second catalogue lands — at which point this is the only function that has to
 * learn how to choose, and every caller is already pointed at it.
 *
 * NO FETCH, AND THAT IS A HARD RULE RATHER THAN AN OBSERVATION ABOUT TODAY'S BODY. This is
 * called from the ROOT LAYOUT, and a fetch there is what made a single sign-in submission
 * allocate ~800MB and take the server into the OOM reaper. Whoever restores negotiation
 * here should reach for cookies and headers — already-parsed request state, free to read —
 * and never for the network. See lib/metadata.ts for the incident.
 *
 * Returns a promise without being `async`, because there is no longer anything to await:
 * the shape is preserved for the callers, and an `async` function with no `await` in it is
 * a lint warning this app treats as an error.
 */
export function activeLocale(): Promise<Locale> {
  return Promise.resolve(DEFAULT_LOCALE)
}
