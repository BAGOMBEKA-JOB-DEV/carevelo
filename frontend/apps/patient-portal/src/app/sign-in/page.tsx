import { SignInForm } from '@/domains/identity'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { redirect } from 'next/navigation'

/**
 * Thin, as every route here is: it resolves the clinic, checks nobody is already signed
 * in, and hands off to the domain. No logic of its own — the boundary rules enforce that.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ phone?: string; error?: string }>
}) {
  const [tenant, user, params] = await Promise.all([resolveTenant(), currentUser(), searchParams])

  if (user) {
    redirect('/')
  }

  return (
    <SignInForm
      phone={params.phone}
      error={params.error}
      clinic={tenant.trading_name ?? 'this clinic'}
    />
  )
}
