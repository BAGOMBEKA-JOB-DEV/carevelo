'use client'

import { useEffect, useRef, type ReactElement } from 'react'
import { Button, Inline, Stack } from '@carevelo/ui'
import en from '../../messages/domains/Errors.en.json'

/**
 * What a patient sees when a page of their own care fails to render.
 *
 * Before this file existed the answer was Next's built-in error screen: a bare sentence in
 * the framework's own type, no clinic anywhere on it, no way back into the portal, and in
 * a development build the message and the stack printed out for anybody standing behind
 * them at a taxi stage. On the connection this product is built for — a mid-range Android
 * on variable Ugandan mobile data, where a request timing out is an ordinary Tuesday — that
 * screen was not the rare case. It was a regular part of using the portal.
 *
 * `'use client'` AND `{ error, reset }` ARE THE FRAMEWORK CONTRACT, NOT A PREFERENCE.
 * Next renders this as the fallback of a React error boundary, and an error boundary is a
 * client component by construction: it catches at render time in the browser. There is no
 * server-rendered variant of this file to reach for.
 *
 * ------------------------------------------------------------------------------------
 * NOTHING FROM THE ERROR OBJECT IS EVER SHOWN, AND `digest` IS THE ONE EXCEPTION THAT IS
 * NOT AN EXCEPTION.
 *
 * `error.message` on this surface can be anything. The portal's reads go through
 * @carevelo/api-client, which translates RFC 9457 problem documents — so a message may
 * carry the API's own sentence, a request URL with a patient or prescription identifier in
 * the path, or a detail written for an operator rather than for the person it is about.
 * `error.stack` carries file paths and, in a development build, source. None of it is
 * rendered here, none of it is logged from here, and there is no branch anywhere below
 * where it becomes visible.
 *
 * `error.digest` is different in kind. Next computes it on the SERVER as a hash of the
 * original error and sends only the hash to the browser, precisely so that a client can
 * name a failure without holding its contents. It matches a line in the server log and it
 * decodes to nothing on its own. So it is shown, labelled as the thing to read out on a
 * telephone call — which is the whole point: an error a patient cannot name is an error a
 * clinic cannot chase, and "it just didn't work" is what a support call sounds like without
 * this line. It is absent on a client-side error, so it renders conditionally.
 *
 * NO CLINICAL CONTENT, and the copy is written so that there is nothing to leak: it never
 * names the page it replaced, the record being read, or what the patient was doing. A
 * sentence like "your prescription could not be loaded" already says a prescription exists.
 * ------------------------------------------------------------------------------------
 *
 * IT OFFERS A NEXT ACTION RATHER THAN AN APOLOGY. `reset()` re-renders the segment, which
 * is a genuine retry for the ordinary cause here — one read that did not come back. Beside
 * it are two ways out: the care hub, and the clinic's own home page. The second is chosen
 * deliberately over printing a telephone number: this component cannot fetch the tenant
 * (see the note on the catalogue below, and lib/tenant.ts for why a fetch here would be a
 * fetch on the failure path of a failure), so it must not invent one. `SiteFooter` renders
 * the clinic's real number as a `tel:` link at the foot of every shelled page, so pointing
 * at a page that HAS the number is both honest and one tap.
 *
 * @see app/not-found.tsx — the same voice for the other failure state, and the reason it
 *      carries no branding either
 */

/**
 * THE WORDS, AND WHY THEY ARE READ OUT OF THE JSON RATHER THAN THROUGH next-intl.
 *
 * There is no NextIntlClientProvider in this app, and SiteShell explains at length why not:
 * a provider serialises part of the catalogue into the RSC payload and pulls the formatting
 * runtime into a bundle with 150KB to spend on a throttled 3G profile. That reasoning does
 * not stop applying because a page failed — if anything it applies harder, since a patient
 * meeting this screen is on the connection that caused it. `createTranslator` from
 * next-intl would work without a provider, but it brings the ICU message parser with it to
 * format sentences that have no ICU arguments at all. So the catalogue is read directly.
 *
 * WHAT IS NOT GIVEN UP BY DOING THAT. The strings live in messages/domains/Errors.en.json
 * with every other domain's, and messages.ts registers the namespace so that a SERVER
 * surface wanting the same sentences later — a `global-error.tsx`, a route without a
 * boundary — gets a type-checked `getTranslations('Errors')` rather than a namespace
 * TypeScript has never heard of.
 *
 * THIS USED TO BE A PAIR OF CATALOGUES AND A HOOK THAT CHOSE BETWEEN THEM. The portal held
 * English and Luganda, and because the locale cookie is not readable from script this
 * component read `<html lang>` in an effect and re-rendered into the matching catalogue.
 * The Luganda locale was removed — i18n/locales.ts carries the reasoning — so there is one
 * catalogue, nothing to choose, and no effect. That is a real improvement on the one screen
 * where it counts most: a patient meeting this component now gets the right words in the
 * FIRST render rather than one frame later, and there is no longer any path by which a
 * server render and a browser render could disagree about which language this page is in.
 *
 * IF YOU ADD A PLACEHOLDER TO ONE OF THESE MESSAGES, THIS MECHANISM STOPS BEING ENOUGH.
 * A direct read renders `{clinic}` as the four literal characters. Every message in this
 * namespace is a plain sentence on purpose — there is no tenant to interpolate here anyway —
 * and a message that needs an argument belongs on a screen that can resolve one.
 */
const COPY = en.Errors

/** Which set of words, and which ways out. Not a description of what went wrong. */
export type ErrorSection =
  | 'generic'
  | 'booking'
  | 'payment'
  | 'consultation'
  | 'registration'

export type PortalErrorScreenProps = {
  section: ErrorSection
  /** Next's error object. Only `digest` is ever read from it — see above. */
  error: Error & { digest?: string | undefined }
  reset: () => void
}

/**
 * The screen itself, exported so a section whose recovery genuinely differs can reuse it
 * with different words instead of copying the focus handling three times.
 *
 * There is no separate module for this because a route file is the only kind of file this
 * layer owns, and app/error.tsx is the canonical one. `book/error.tsx` and
 * `payments/[payment]/error.tsx` are four lines each on top of it.
 */
export function PortalErrorScreen({
  section,
  error,
  reset,
}: PortalErrorScreenProps): ReactElement {
  const words = COPY[section]

  /*
   * Focus moves to the heading once, on mount.
   *
   * A React error boundary swaps the page out underneath the reader without a navigation,
   * so nothing announces and focus stays on whatever the old page had — frequently a
   * control that no longer exists, which leaves a screen-reader user tabbing through a
   * page they were never told they had arrived at. Moving focus to the <h1> is what a real
   * navigation would have done. `tabIndex={-1}` makes the heading focusable
   * programmatically without adding it to the tab order, so nobody ever tabs INTO a
   * heading afterwards.
   */
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    heading.current?.focus()
  }, [])

  return (
    <main className="site-pagehero">
      <Stack gap="6">
        <h1 className="site-h1" ref={heading} tabIndex={-1}>
          {words.title}
        </h1>

        <p className="site-lede">{words.body}</p>

        <Inline gap="4" justify="center">
          {/* `type="button"` explicitly: this is not in a form today and must not become a
              submit if it ever ends up inside one. */}
          <Button variant="brand" size="lg" type="button" onClick={reset}>
            {COPY.generic.retry}
          </Button>

          {section === 'generic' ? (
            <>
              <Button variant="quiet" size="lg" href="/account">
                {COPY.generic.hub}
              </Button>
              <Button variant="ghost" size="lg" href="/">
                {COPY.generic.home}
              </Button>
            </>
          ) : null}

          {section === 'booking' ? (
            <>
              <Button variant="quiet" size="lg" href="/appointments">
                {COPY.booking.appointments}
              </Button>
              <Button variant="ghost" size="lg" href="/services">
                {COPY.booking.services}
              </Button>
            </>
          ) : null}

          {section === 'payment' ? (
            <>
              <Button variant="quiet" size="lg" href="/appointments">
                {COPY.payment.appointments}
              </Button>
              <Button variant="ghost" size="lg" href="/">
                {COPY.generic.home}
              </Button>
            </>
          ) : null}

          {section === 'consultation' ? (
            <>
              {/* Only the appointment list. NOT the consultation link itself: this screen
                  cannot know which appointment failed, and a second way back into a room
                  that has just thrown is a loop rather than a recovery. */}
              <Button variant="quiet" size="lg" href="/appointments">
                {COPY.consultation.appointments}
              </Button>
              <Button variant="ghost" size="lg" href="/account">
                {COPY.generic.hub}
              </Button>
            </>
          ) : null}

          {section === 'registration' ? (
            <>
              {/* "Try registering again" goes back to the FORM rather than resubmitting
                  anything — see register/error.tsx for why the copy beside it tells a
                  patient to telephone before filling it in a second time. */}
              <Button variant="quiet" size="lg" href="/register">
                {COPY.registration.startAgain}
              </Button>
              {/* Offered because the ordinary reason a registration fails on the second
                  attempt is that the first one worked. */}
              <Button variant="ghost" size="lg" href="/sign-in">
                {COPY.registration.signIn}
              </Button>
            </>
          ) : null}
        </Inline>

        <p className="fine">{COPY.generic.reachClinic}</p>

        {/* Only ever the digest, only ever when the server produced one. See the docblock:
            this is a hash of the error, computed server-side, and it is the difference
            between a support call that can be traced and one that cannot. */}
        {error.digest === undefined ? null : (
          <p className="fine">
            {COPY.generic.referenceLabel}
            {': '}
            <span className="mono">{error.digest}</span>
            <br />
            {COPY.generic.referenceNote}
          </p>
        )}
      </Stack>
    </main>
  )
}

export default function PortalError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  return <PortalErrorScreen section="generic" error={error} reset={reset} />
}
