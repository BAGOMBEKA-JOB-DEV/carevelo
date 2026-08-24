'use client'

import type { ReactElement } from 'react'
import { PortalErrorScreen } from '../error'

/**
 * The delivery list, or the tracking page beneath it, failed to render.
 *
 * A BOUNDARY AT THIS SEGMENT RATHER THAN NONE, for the reason orders/error.tsx sets out:
 * the words are the same ones app/error.tsx would have rendered, and what this file changes
 * is the SCOPE of `reset()` — the segment re-renders rather than everything below the root
 * layout. It earns that on this segment in particular, because the tracking page under it
 * is a screen a patient sits on and re-reads while a package moves, and its ordinary
 * failure is one read that did not come back.
 *
 * `'use client'` AND `{ error, reset }` ARE THE FRAMEWORK CONTRACT. An error boundary
 * catches at render time in the browser; there is no server-rendered variant of this file.
 *
 * `section="generic"` because this segment is behind a session, so "Go to your care" leads
 * somewhere the reader can get to — the test consent/error.tsx applies when it argues the
 * generic screen is wrong for somebody without an account.
 *
 * WHAT THIS SCREEN MUST NOT DO IS SAY ANYTHING ABOUT THE PACKAGE. A page that failed before
 * reading anything knows neither where the delivery is nor whether it arrived, and the
 * generic copy claims nothing in either direction. It must stay that way: "your delivery
 * could not be loaded" already asserts that a delivery exists, which on a system where the
 * mere fact that a named person is a patient of a named clinic is special-category data is
 * a sentence worth not writing.
 *
 * Nothing from the error object is rendered except `digest` — see app/error.tsx.
 */
export default function DeliveriesError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  return <PortalErrorScreen section="generic" error={error} reset={reset} />
}
