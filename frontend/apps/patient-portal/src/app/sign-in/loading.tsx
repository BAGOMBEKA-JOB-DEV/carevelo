import type { ReactElement } from 'react'
import { Skeleton, Stack } from '@carevelo/ui'

/**
 * The sign-in split screen, held in place while the clinic is resolved.
 *
 * NO `SiteShell` AND NO `.site-root` HERE, WHICH IS THE OPPOSITE OF EVERY OTHER FALLBACK IN
 * THIS APP AND MATCHES THE PAGE RATHER THAN DIVERGING FROM IT. `SignInForm` renders
 * `.auth-page`: a full-bleed two-track grid with the clinic's band on one side and the form
 * on the other, and no site header at all. `SiteShell` explains why — there is no room for
 * site chrome on this screen. So the wrapper that hands back the header's height everywhere
 * else would put an entire header's worth of empty space at the top of a page that has no
 * header, and then take it away again.
 *
 * WHAT IT IS WAITING ON. `resolveTenant()`, and only that. The form itself is synchronous.
 * But the tenant is what puts the clinic's logo, name and colours on this screen, and this
 * is the first authenticated surface of a white-label product: a patient signing in has to
 * see their own clinic, so the page cannot render before the tenant answers.
 *
 * THE BRAND PANEL IS RESERVED AND NOT DRAWN. `.auth__brand` carries the clinic's mark, a
 * sentence of the clinic's own, and three figures — "4 steps to care", "24/7 book any time",
 * "100% paid to the clinic". Every one of those is a claim, and a grey rectangle in the shape
 * of a claim is still an outline of one. The panel is reserved at its height, and its
 * contents arrive together.
 *
 * NOTHING HERE READS THE CLINIC'S TOKENS, so the band paints with the package defaults for
 * the moment it is up and then takes the clinic's colours when the page lands. That is a
 * shift of hue on one panel, against the alternative of a blank white viewport on the screen
 * where somebody types a password.
 *
 * THE HEADING IS RESERVED THOUGH "Sign in" IS FIXED. It sits under an eyebrow that is also
 * fixed, and both are English string literals inside `SignInForm` rather than catalogue keys
 * — this one screen is not translated, and a fallback that hard-coded the same two English
 * words here would put the app's only untranslated copy in a second place for a translator
 * to find later. Reserved is cheaper to keep true.
 */
export default function SignInLoading(): ReactElement {
  return (
    <div className="auth-page">
      <aside className="auth__brand">
        {/* The clinic's mark, its sentence, and the three figures under it. Reserved as one
            block: they are one panel and they arrive together. */}
        <Skeleton block="lg" />
      </aside>

      <main className="auth__form">
        <div className="auth__card">
          <Stack gap="6">
            {/* The eyebrow, the heading and the line under it. */}
            <Stack gap="4">
              <Skeleton lines={1} />
              <Skeleton lines={1} className="title-lg" />
              <Skeleton lines={1} />
            </Stack>

            {/* `.auth__fields` is a 16px column, which is what `gap="5"` is, so the two
                fields and the button land where they will land. */}
            <Stack gap="5">
              {/* Email, then password. */}
              <Skeleton block="sm" />
              <Skeleton block="sm" />
              {/* The full-width submit. Reserved on its own so it does not arrive by pushing
                  the page under a thumb already moving towards it. */}
              <Skeleton lines={1} />
            </Stack>

            {/* The two notes under the form: how to register, and the way back to the
                clinic's front page. */}
            <Skeleton lines={2} />
          </Stack>
        </div>
      </main>
    </div>
  )
}
