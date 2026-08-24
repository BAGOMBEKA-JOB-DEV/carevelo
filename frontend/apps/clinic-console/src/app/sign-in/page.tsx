import type { Metadata } from 'next'
import { SignInScreen } from '@/domains/identity'
import { IDENTITY_PATHS } from './paths'

/**
 * The way into the clinic console.
 *
 * Thin, as every route here is: it names the section, hands the domain the paths the route
 * layer has chosen, and passes the search parameters through untouched. The boundary rules
 * enforce that a route holds no logic, and this one has none to hold — what a failed
 * attempt means, and how it must be worded, belongs to the identity domain.
 *
 * NO `ConsoleShell`. This is a full-bleed split screen for somebody who has no session, and
 * a sidebar of six links that would all answer 401 is worse than no sidebar at all.
 *
 * THIS PAGE DOES NOT REDIRECT A SIGNED-IN VISITOR ANYWHERE, and a future change must not
 * make it. See the account of the cycle in
 * `domains/identity/components/SignInScreen.tsx` — it is an infinite loop that fires
 * exactly on the render Next performs for a Server Action redirect, and it cost the patient
 * portal ~800MB a submission and an OOM-killed server.
 */
export const metadata: Metadata = { title: 'Sign in' }

export default async function SignInPage({
  searchParams,
}: {
  /* `string | string[]` because that is what a URL can genuinely produce — `?error=a&error=b`
     is legal. Narrowing it here would be logic in a route; the domain does it. */
  searchParams: Promise<{ error?: string | string[]; signed_out?: string | string[] }>
}) {
  const params = await searchParams

  return (
    <SignInScreen paths={IDENTITY_PATHS} error={params.error} signedOut={params.signed_out} />
  )
}
