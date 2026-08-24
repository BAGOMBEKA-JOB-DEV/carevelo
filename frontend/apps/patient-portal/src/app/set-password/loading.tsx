import type { ReactElement } from 'react'
import { Skeleton, Stack } from '@carevelo/ui'

/**
 * Choosing a password, held in place while the clinic and the session are resolved.
 *
 * The same frame and the same argument as sign-in/loading.tsx — read that file for why
 * `.auth-page` is reproduced by hand, why there is no `.site-root`, and why the clinic's
 * band is reserved rather than drawn.
 *
 * IT WAITS ON ONE ROUND TRIP MORE THAN SIGN-IN DOES. This page resolves the tenant AND
 * `currentUser()`, because somebody who is not signed in has no password to change and is
 * sent back to /sign-in. Both go out together, so the wait is the slower of the two rather
 * than the sum — but this route is reached by a redirect immediately after signing in, which
 * means the fallback lands on a patient who has just pressed a button and is watching for
 * evidence that it worked.
 *
 * THREE FIELDS, NOT TWO, and that is the whole reason this file exists separately from the
 * sign-in fallback rather than inheriting it. `SetPasswordForm` asks for the current
 * password, the new one and a confirmation. A fallback one field short would resolve into a
 * form that is taller than the shape it promised, moving the submit button downward at the
 * moment somebody is reaching for it — which on this screen means a mis-tap on the page
 * where a password has just been typed twice.
 */
export default function SetPasswordLoading(): ReactElement {
  return (
    <div className="auth-page">
      <aside className="auth__brand">
        <Skeleton block="lg" />
      </aside>

      <main className="auth__form">
        <div className="auth__card">
          <Stack gap="6">
            <Stack gap="4">
              <Skeleton lines={1} />
              <Skeleton lines={1} className="title-lg" />
              <Skeleton lines={2} />
            </Stack>

            <Stack gap="5">
              {/* The password the clinic issued, then the new one, then the confirmation. */}
              <Skeleton block="sm" />
              <Skeleton block="sm" />
              <Skeleton block="sm" />
              <Skeleton lines={1} />
            </Stack>

            <Skeleton lines={2} />
          </Stack>
        </div>
      </main>
    </div>
  )
}
