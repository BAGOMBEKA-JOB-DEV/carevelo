import type { Metadata } from 'next'
import { SignOutScreen } from '@/domains/identity'
import { SignOutSubmit } from '@/domains/consultations'
import { IDENTITY_PATHS } from '../sign-in/paths'

/**
 * Leaving the console.
 *
 * A PAGE, NOT A LINK THAT SIGNS YOU OUT ON SIGHT. A GET that changes state can be fired by
 * a link prefetch or an `<img>` whose `src` somebody pasted, and an accidental sign-out is
 * indistinguishable from a deliberate one afterwards. So the nav link is an ordinary
 * navigation here and the sign-out itself is a POST from a form on this page.
 *
 * `IDENTITY_PATHS` is imported from the sign-in route rather than duplicated, because these
 * two routes are one journey and a second copy of the paths is a second thing to forget
 * when one of them moves. Route-to-route imports are fine; it is a route being imported BY
 * a domain that the boundary rules forbid, and none of them are.
 */
export const metadata: Metadata = { title: 'Sign out' }

export default function SignOutPage() {
  /*
   * THE ROUTE COMPOSES THE TWO DOMAINS, which is what the boundary rules ask for.
   * `SignOutSubmit` is consultations' -- it clears the note drafts, and the drafts are
   * that domain's -- while the screen around it is identity's. Neither imports the other.
   */
  return <SignOutScreen paths={IDENTITY_PATHS} submit={<SignOutSubmit />} />
}
