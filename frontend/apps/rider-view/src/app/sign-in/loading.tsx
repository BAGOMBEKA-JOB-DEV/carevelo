import type { ReactElement } from 'react'
import { PageHeader, Skeleton, Stack } from '@carevelo/ui'

/**
 * The sign-in form, held in place while the route resolves.
 *
 * WHY A ROUTE THAT FETCHES NOTHING STILL EARNS A FALLBACK. `SignInScreen` is synchronous
 * and the page awaits only `searchParams`, so nothing here waits on the API. What a rider
 * waits on is the NAVIGATION itself: tapping "Sign in" from anywhere in the app costs a
 * round trip for the RSC payload before a single pixel can change, and that round trip is
 * made from a phone on the network this whole product exists because of. Without a file at
 * this segment the previous screen stays on the display for the whole of it, which is
 * indistinguishable from a tap that did not register — and the honest response to a tap
 * that did not register is another tap.
 *
 * IT IS NOT `FieldShell`, AND THAT MATCHES THE PAGE RATHER THAN DIVERGING FROM IT.
 * `SignInScreen` renders the `.fieldview` frame and the topbar BY HAND and deliberately
 * omits the tab bar: both tabs would bounce a guest straight back here, and navigation you
 * cannot use is navigation that teaches you to distrust the screen. So this fallback
 * reproduces exactly what the screen reproduces — the frame, the padding, the topbar — and
 * nothing that the screen refuses to show.
 *
 * BOTH STRINGS IN THE HEADER ARE REAL. "Sign in" and "Use the phone number your clinic has
 * for you." are fixed strings in `SignInScreen`; neither depends on anything fetched, so
 * rendering grey bars in their place would be pretending not to know something we know and
 * would leave this fallback with no <h1> for a screen reader to land on.
 *
 * WHAT IS NOT RESERVED IS THE ERROR NOTICE. It appears only when `?error=` is set, a
 * `loading.tsx` is passed no search parameters, and a permanently reserved band above the
 * form would put a hole on the screen every ordinary morning to save one reflow on the
 * mornings a rider has mistyped a number.
 */
export default function SignInLoading(): ReactElement {
  return (
    <div className="fieldview">
      {/* No skip link: it points at `#signin`, which does not exist until the form does,
          and a skip link that lands nowhere is worse than none. */}
      <header className="topbar">
        <span className="topbar__title">Deliveries</span>
      </header>

      <main className="fieldview__main">
        <PageHeader title="Sign in" description="Use the phone number your clinic has for you." />

        {/* `.auth__fields` on the real form is a 16px column, which is what `gap="5"` is,
            so the two fields and the button land where they will land. */}
        <Stack gap="5">
          {/* The phone field: label, hint and the input. */}
          <Skeleton block="sm" />
          {/* The password field: label and the input, with no hint under it. */}
          <Skeleton block="sm" />
          {/* The one target on the screen — 52px tall, full width, pressed with a thumb.
              Reserved on its own so it does not arrive by pushing the page under a thumb
              that is already moving towards it. */}
          <Skeleton lines={1} />
        </Stack>

        {/* The "trouble signing in?" note, which is on the screen every time. */}
        <Skeleton lines={2} />
      </main>
    </div>
  )
}
