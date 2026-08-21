import type { Metadata } from 'next'
import { SignInScreen } from '@/domains/identity'

/**
 * Thin, as every route here is: read one search parameter and hand off to the domain. No
 * logic of its own — the boundary rules enforce that.
 *
 * No `<FieldShell>`: the tab bar offers two destinations that would both bounce a guest
 * straight back here, and navigation you cannot use is navigation that teaches you to
 * distrust the screen. The sign-in screen renders the `.fieldview` frame itself.
 *
 * ==================================================================
 * THIS PAGE DELIBERATELY DOES NOT REDIRECT A SIGNED-IN RIDER TO /assignments.
 * ==================================================================
 *
 * It is the obvious convenience and it is a latent infinite loop. Paired with
 * /assignments' "no session, go to /sign-in", it would be two pages redirecting to each
 * other on opposite readings of the same session — which fires exactly when the reading is
 * momentarily inconsistent: the render Next performs for a Server Action redirect,
 * immediately after the sign-in action has written the session cookie.
 *
 * The patient portal shipped that pairing and measured the result: roughly 800MB per
 * submission, an RSC stream that closed early, a browser that never navigated, and an
 * OOM-killed server after three attempts. What it buys is that a signed-in person who
 * navigates back to the sign-in screen sees the sign-in screen. /assignments keeps its
 * guard, because a guest reaching it must go somewhere; this side is the one that can
 * safely just render.
 */
export const metadata: Metadata = { title: 'Sign in' }

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const { error } = await searchParams

  return <SignInScreen error={error} />
}
