import type { ReactElement } from 'react'
import { Skeleton, Stack } from '@carevelo/ui'

/**
 * Signing out, held in place while the session is read.
 *
 * See sign-in/loading.tsx for why `.auth-page` is reproduced by hand, why there is no
 * `ConsoleShell`, and why nothing on it is translated. This is a separate file only because
 * `/sign-out` and `/sign-in` are sibling segments: Next walks up from the failing segment, and
 * neither is underneath the other.
 *
 * IT WAITS ON `currentUser()`, WHICH IS THE PART WORTH SAYING OUT LOUD. `SignOutScreen` names
 * the member of staff it is about to sign out — that is the whole safety of the screen, on a
 * machine at a front desk that several people use in a morning. So the page cannot render
 * until the API has answered, and until this file existed the console showed whatever screen
 * the person was on while it did. Clicking "Sign out" and watching the patient record stay on
 * the display is indistinguishable from a click that did not register, and the honest
 * response to a click that did not register is another click — on a machine where the next
 * person is already standing there.
 *
 * THE NAME IS RESERVED AND NEVER DRAWN. It sits in the eyebrow above the heading, and it is
 * the one fact on this screen that says WHOSE session is about to end. A plausible-looking bar
 * in its position lets somebody press the button believing they know the answer.
 *
 * ONE FIELD-HEIGHT SHORTER THAN THE SIGN-IN FALLBACK, because this screen has no fields at
 * all: a sentence, and the button that ends the session.
 */
export default function SignOutLoading(): ReactElement {
  return (
    <div className="auth-page">
      <aside className="auth__brand">
        <Skeleton block="lg" />
      </aside>

      <main className="auth__form">
        <div className="auth__card">
          <Stack gap="6">
            {/* The member of staff's name, the heading, and what signing out does. */}
            <Stack gap="4">
              <Skeleton lines={1} />
              <Skeleton lines={1} className="title-lg" />
              <Skeleton lines={2} />
            </Stack>

            <Stack gap="5">
              {/* The one control on the screen. */}
              <Skeleton lines={1} />
            </Stack>

            {/* The way back into the console for somebody who did not mean to be here. */}
            <Skeleton lines={1} />
          </Stack>
        </div>
      </main>
    </div>
  )
}
