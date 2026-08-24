import type { ReactElement } from 'react'
import { Skeleton, Stack } from '@carevelo/ui'

/**
 * The console's sign-in split screen, held in place while the session is resolved.
 *
 * NO `ConsoleShell` HERE, WHICH IS THE OPPOSITE OF EVERY OTHER FALLBACK IN THIS APP AND
 * MATCHES THE PAGE RATHER THAN DIVERGING FROM IT. `SignInScreen` renders `.auth-page`: a
 * full-bleed two-track grid with no sidebar, no topbar and no tab bar, because navigation
 * offered to somebody who is not signed in is navigation that bounces them straight back
 * here. Rendering the shell in this fallback would put a whole console's chrome on screen and
 * then take it away again at the moment somebody is reaching for a password field.
 *
 * IT COVERS `sign-in/new-password` TOO, AND THAT IS DELIBERATE RATHER THAN AN OVERSIGHT.
 * Next walks up to the nearest `loading.tsx`, so choosing a password inherits this one. The
 * two screens are the same frame, the same card and the same column of fields — the second
 * has three fields where the first has two — and a separate file would repeat this one to
 * change a count. Reserving two field-heights where three are coming moves the submit button
 * down by one field once; a second copy of this file moves the argument for it into two
 * places forever.
 *
 * BOTH ROUTES WAIT ON A REAL READ, which is why this is not merely a navigation fallback.
 * `SignInScreen` resolves the console's own address before it can render, and
 * `NewPasswordScreen` reads `currentUser()` — it puts the member of staff's own name in the
 * eyebrow above the heading. On the clinic's connection that is a round trip in front of the
 * screen somebody uses first thing in the morning.
 *
 * NOTHING HERE IS TRANSLATED AND NOTHING HERE NEEDS TO BE. This console is English by
 * decision — `domains/identity/index.ts` states it — so the strings that would go on this
 * screen are English literals inside the screen itself. They are reserved rather than copied
 * here, because a heading duplicated into a fallback is a second place for it to drift.
 *
 * NO SKIP LINK. The real screens point one at `#signin` and `#password`, and those anchors do
 * not exist until the form does; a skip link that lands nowhere is worse than none.
 */
export default function SignInLoading(): ReactElement {
  return (
    <div className="auth-page">
      <aside className="auth__brand">
        {/* The console's mark, the sentence beside it, and the three figures under it —
            twenty-minute idle sign-out, every action audited, one clinic per session. Each
            of those is a claim about how this console behaves, and a grey rectangle in the
            shape of a claim is still an outline of one, so the panel is reserved whole and
            its contents arrive together. */}
        <Skeleton block="lg" />
      </aside>

      <main className="auth__form">
        <div className="auth__card">
          <Stack gap="6">
            {/* The eyebrow, the heading and the line under it. */}
            <Stack gap="4">
              <Skeleton lines={1} />
              <Skeleton lines={1} className="title-lg" />
              <Skeleton lines={2} />
            </Stack>

            {/* `.auth__fields` is a 16px column, which is what `gap="5"` is, so the fields
                and the button land where they will land. */}
            <Stack gap="5">
              <Skeleton block="sm" />
              <Skeleton block="sm" />
              {/* The full-width submit, reserved on its own row. */}
              <Skeleton lines={1} />
            </Stack>

            {/* The notes under the form: who to ask for a reset, and the way back. */}
            <Skeleton lines={2} />
          </Stack>
        </div>
      </main>
    </div>
  )
}
