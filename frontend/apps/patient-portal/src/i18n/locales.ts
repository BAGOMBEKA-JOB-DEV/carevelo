/**
 * Which languages this portal reads in.
 *
 * ONE LANGUAGE, AND A LIST THAT STILL EXISTS. That combination looks redundant on the day
 * it is written, so here is the reasoning in full rather than a comment saying "for later".
 *
 * The portal shipped with two entries here, `en` and `lg`, and a footer control to move
 * between them. The Luganda catalogue never got past 7% — 186 of 201 portal keys held the
 * ENGLISH text verbatim, waiting on a translator who is not coming — and a language button
 * that swaps one set of English sentences for another set of English sentences labelled
 * "Oluganda" is not a partial feature. It is a false claim about the product made to the
 * patient least able to check it, on a surface whose most important screen is a consent
 * form. Shipping English is honest; shipping English wearing a Luganda label is not. So the
 * locale went, and with it the choosing: the switcher, the cookie that remembered a choice,
 * the Accept-Language negotiation that guessed one, and the second copy of every catalogue.
 *
 * WHAT DELIBERATELY DID NOT GO IS next-intl AND THE CATALOGUE UNDER messages/. The
 * architecture note is explicit that "retrofitting internationalisation is far more
 * expensive than allowing for it", and it is right: every sentence in this app is already
 * out of the JSX and in a keyed catalogue, every `t()` call is already type-checked against
 * it, and every screen already renders from a message rather than from a literal. Adding a
 * language back is then a file and one more entry in the list below. Ripping the message
 * layer out to save the indirection would trade a few hundred bytes today for the rewrite
 * the architecture note warns about.
 *
 * NO `[locale]` URL SEGMENT, AND THAT DECISION SURVIVES THE REMOVAL RATHER THAN BEING MADE
 * MOOT BY IT. The obvious next-intl setup puts every route under app/[locale]/, which for
 * this app would mean every page gaining a param it does not want and the tenant — resolved
 * from the HOST and from nowhere else — sharing the URL with a second dimension of routing.
 * The host is the only thing that decides which clinic a request belongs to, and adding a
 * path segment that decides something else invites the next person to reach for the URL
 * when they want the tenant too. next-intl does not require the segment: `getRequestConfig`
 * may return any locale it likes. Whoever adds the second language should read that again
 * before adding the segment along with it.
 *
 * @see docs/30-architecture/frontend-nextjs.md
 * @see docs/10-product/prd-h2-patient-registration-consent.md
 */

/**
 * Every language this portal holds a catalogue for.
 *
 * Kept as a list of one rather than collapsed to a bare type alias, because a second entry
 * here plus a `messages/<code>.json` plus a way to choose is the whole shape of adding a
 * language — and a list is what makes that obvious to whoever comes to do it. i18n.test.ts
 * reads it, so it is not an unreferenced export either.
 */
export const LOCALES = ['en'] as const

export type Locale = (typeof LOCALES)[number]

/**
 * What every request gets, since there is nothing else to get.
 *
 * Still named DEFAULT rather than folded into a single `LOCALE` constant: this is the
 * FALLBACK position — the language a request lands in when nothing has said otherwise — and
 * that is a different idea from "the only language", even while the two coincide. When a
 * second catalogue arrives, the fallback is the value that must not move, because English
 * is the language every screen in this app is authored in and therefore the only one
 * guaranteed to be real prose rather than a placeholder.
 */
export const DEFAULT_LOCALE: Locale = 'en'
