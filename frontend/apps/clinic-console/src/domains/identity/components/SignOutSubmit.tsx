'use client'

import type { ReactElement } from 'react'
import { Button } from '@carevelo/ui'
import { clearAllDrafts } from '@/domains/consultations'

/**
 * The sign-out button, and the one thing signing out has to do in the BROWSER.
 *
 * ====================================================================================
 * WHY THIS FILE EXISTS AT ALL: A SERVER ACTION CANNOT REACH INTO localStorage
 * ====================================================================================
 *
 * Acceptance criterion 7 — "no clinical data persists in client storage beyond the active
 * note draft" — makes clearing the note drafts part of what signing out MEANS on this
 * console, not a nicety attached to it. `SignOutScreen` is a server component posting to a
 * Server Action, and neither of those runs anywhere near a browser's storage. So the clear
 * has to happen on the client, in the same press, and a press is the only moment at which it
 * is correct to do it.
 *
 * ON THE PRESS, AND EMPHATICALLY NOT ON MOUNT. Rendering this screen is not signing out —
 * the screen offers "Stay signed in and go back", and a clinician who opens it, thinks
 * better of it and returns to the room must find their note where they left it. An effect
 * that cleared drafts when the page appeared would destroy a clinical record on a navigation
 * the clinician deliberately reversed. That is the single most expensive mistake available
 * in this file, and it is available because it looks tidier.
 *
 * `onClick` RATHER THAN A SUBMIT LISTENER ON THE FORM, because a click on a submit button
 * fires before the form's submit event, needs no DOM traversal to find the form, and is also
 * what an Enter key in the form dispatches — the browser's implicit submission clicks this
 * button. `localStorage.removeItem` is synchronous, so the drafts are gone before the POST
 * leaves the page rather than racing it.
 *
 * ====================================================================================
 * WHAT HAPPENS WHEN THE BUNDLE HAS NOT ARRIVED, WHICH IS THE HONEST PART
 * ====================================================================================
 *
 * `SignOutScreen` says signing out "must not depend on a bundle having arrived, least of all
 * on the connection that has just started failing", and that is still true after this change:
 * this component is server-rendered like any other, so the button is in the initial HTML and
 * the form posts natively whether or not React ever hydrates. Signing out cannot be broken by
 * this file.
 *
 * What CAN happen is that the sign-out succeeds and the drafts are not cleared, because
 * nothing was listening for the click. It is worth being plain about it rather than implying
 * a guarantee: this is a best-effort clear on a hard requirement, and the requirement's real
 * backstop is elsewhere — the draft key is scoped to the signed-in user, so the next
 * clinician on the handset finds their own empty editor. That scoping was never sufficient
 * on its own (the text is still in storage, readable by anything with script access to the
 * origin), which is why the clear exists; and the clear is not sufficient on its own either,
 * which is why the scoping stays. Neither is presented as the other.
 *
 * The alternative — refusing to sign out until JavaScript has arrived — trades a surviving
 * draft for a clinician who cannot leave a terminal in a room the public walks through. That
 * is the wrong way round.
 *
 * ====================================================================================
 * IT REACHES ACROSS A DOMAIN BOUNDARY, THROUGH THE FRONT DOOR
 * ====================================================================================
 *
 * `clearAllDrafts` comes from `@/domains/consultations` — the public surface, which is the
 * one import into that domain the boundary rules allow. `model/drafts.ts` specified this
 * exact arrangement before either end of it existed: the function is "exported from the
 * domain's public surface so the identity domain can call it from its sign-out path", so
 * that there is one function to call and no temptation to reimplement the key format here,
 * "where a mismatched prefix would fail silently and leave a previous clinician's notes on a
 * shared clinic handset".
 */
export function SignOutSubmit(): ReactElement {
  return (
    <Button
      type="submit"
      variant="primary"
      size="lg"
      block
      onClick={() => {
        /*
         * Never throws — see clearAllDrafts, which swallows the storage exception on
         * purpose. If it could throw, this handler would have to catch anyway: an
         * exception here would be an unhandled rejection between a clinician and the
         * doorway out of a shared terminal.
         */
        clearAllDrafts()
      }}
    >
      Sign out
    </Button>
  )
}
