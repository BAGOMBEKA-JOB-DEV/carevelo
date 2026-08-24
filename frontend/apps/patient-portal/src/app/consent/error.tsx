'use client'

import type { ReactElement } from 'react'
import { PortalErrorScreen } from '../error'

/**
 * The consent step of registration failed.
 *
 * IT SHARES register/error.tsx's WORDS, AND IS A SEPARATE FILE ONLY BECAUSE `/register` AND
 * `/consent` ARE SIBLING SEGMENTS. Next walks up from the failing segment, and `/consent` is
 * not underneath `/register`, so the boundary has to exist at this path in order to catch
 * anything at all. The alternative — one boundary at the app root — is the generic screen,
 * which offers "Go to your care" to somebody who does not have an account yet.
 *
 * WHY THE REGISTRATION WORDS ARE THE RIGHT ONES HERE. A patient who meets a broken page in
 * the middle of registering does not distinguish the two steps; what they know is that they
 * filled a form in and something went wrong. The instruction that matters is the same at
 * both steps and is the one that prevents the expensive outcome: do not start again from
 * the beginning, because a second registration is a duplicate record that has to be merged
 * by hand.
 *
 * WHAT THIS SCREEN MUST NOT DO IS IMPLY A DECISION WAS RECORDED. Consent is the one thing
 * on this surface that is a legal record of what a patient agreed to, and a page that failed
 * before reading anything knows neither what was shown nor what was pressed. The copy claims
 * nothing about it in either direction, and the clinic — which can see the consent history
 * on the console's consent desk — is named as the way to find out.
 *
 * `reset()` re-renders the segment: it reads the registration handoff and the current
 * consent policy. Recording a decision is a Server Action, and re-rendering the page an
 * action was invoked from does not replay the action, so the retry cannot grant or withdraw
 * anything.
 *
 * Nothing from the error object is rendered except `digest` — see app/error.tsx.
 */
export default function ConsentError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  return <PortalErrorScreen section="registration" error={error} reset={reset} />
}
