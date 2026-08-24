import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { SignInScreen, authoriseOperator, problemFrom, stepFrom } from '@/domains/identity'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'
import { IDENTITY_PATHS } from '../paths'

/**
 * The one route on this surface that may be reached without a session.
 *
 * THIN, LIKE EVERY OTHER ROUTE HERE. It resolves, narrows the two search parameters against
 * the identity domain's closed sets, and hands off. What `?problem=code_rejected` means and
 * which values are real is the domain's business, decided in one place against one list —
 * a route that translated them into props with meanings of its own would be the sign-in
 * rules restated in the routing tree, free to drift from the screen they govern.
 *
 * AN OPERATOR WHO IS ALREADY SIGNED IN IS SENT AWAY. Not because it would be unsafe to draw
 * the form — posting it would simply start a second sign-in — but because a sign-in page
 * shown to somebody who is signed in reads as "your session has gone", which on a surface
 * with a fifteen-minute idle timeout is the one message that must mean what it says.
 *
 * `active={null}`: this is not one of the nav sections and it says so out loud rather than
 * leaving the prop off.
 */
export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; problem?: string; message?: string }>
}) {
  const [access, params] = await Promise.all([authoriseOperator(), searchParams])

  if (access.kind === 'operator') {
    redirect(IDENTITY_PATHS.afterSignIn)
  }

  return (
    <ControlPlaneShell title="Carevelo platform" active={null}>
      <SignInScreen
        paths={IDENTITY_PATHS}
        step={stepFrom(params.step)}
        problem={problemFrom(params.problem)}
        message={params.message}
      />
    </ControlPlaneShell>
  )
}
