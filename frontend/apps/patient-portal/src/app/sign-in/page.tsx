import { redirect } from 'next/navigation'
import { SignInForm } from '@/domains/identity'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'

/**
 * Thin, as every route here is: resolve the clinic, send an already-signed-in person on,
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
  const [tenant, user, params] = await Promise.all([resolveTenant(), currentUser(), searchParams])

  if (user) {
    redirect('/account')
  }

  return <SignInForm tenant={tenant} error={params.error} />
}
