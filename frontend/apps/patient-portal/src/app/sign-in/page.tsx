import { redirect } from 'next/navigation'
import { SignInForm } from '@/domains/identity'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'

/**
 * Thin, as every route here is: resolve the clinic, send an already-signed-in person on,
 * and hand off to the domain. No logic of its own — the boundary rules enforce that.
 *
 * No SiteShell: this is a full-bleed split screen, and site chrome above it would leave
 * the clinic's panel floating in the middle of a page.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; method?: string; error?: string }>
}) {
  const [tenant, user, params] = await Promise.all([resolveTenant(), currentUser(), searchParams])

  if (user) {
    redirect('/account')
  }

  return (
    <SignInForm
      tenant={tenant}
      phone={params.phone}
      method={params.method}
      error={params.error}
    />
  )
}
