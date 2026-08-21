import { clinicMetadata } from '@/lib/metadata'
import { SignInForm } from '@/domains/identity'
import { resolveTenant } from '@/lib/tenant'

/**
 * Thin, as every route here is: resolve the clinic
 * and hand off to the domain. No logic of its own — the boundary rules enforce that.
 *
 * ONE SEARCH PARAMETER LEFT. `phone` and `method` went with the phone one-time-code flow:
 * signing in is an email address and a password, so there is no method to select and no
 * number to carry between screens. `error` survives because a failed sign-in is a redirect
 * back here, and the message has to travel somehow.
 *
 * No SiteShell: this is a full-bleed split screen, and site chrome above it would leave
 * the clinic's panel floating in the middle of a page.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>
}) {
  const [tenant, params] = await Promise.all([resolveTenant(), searchParams])

  /*
   * THIS PAGE DELIBERATELY DOES NOT REDIRECT A SIGNED-IN VISITOR TO /account.
   *
   * It used to, and paired with /account's "no session, go to /sign-in" it formed a cycle:
   * two pages redirecting to each other on opposite readings of the same session. That is
   * a latent infinite loop, and it fires exactly when the reading is momentarily
   * inconsistent — which is what happens on the render Next performs for a Server Action
   * redirect, immediately after the action has written the session cookie. The loop ran
   * server-side inside the action response: ~800MB per submission, an RSC stream that
   * closed early, a browser that never navigated, and an OOM-killed server after three
   * attempts.
   *
   * The convenience it bought was small — a signed-in person who navigates back to the
   * sign-in screen sees the sign-in screen — and the cycle it created was not. /account
   * keeps its guard, because a guest reaching it must go somewhere; this side is the one
   * that can safely just render.
   */
  return <SignInForm tenant={tenant} error={params.error} />
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
