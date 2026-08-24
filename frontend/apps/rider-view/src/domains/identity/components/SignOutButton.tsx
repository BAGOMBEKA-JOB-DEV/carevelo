import { Button } from '@carevelo/ui'
import { signOut } from '../api/session'

/**
 * Sign out.
 *
 * A FORM, NOT A LINK. Signing out changes state, and a GET that changes state is
 * something a prefetcher, a link scanner or an over-eager browser can trigger without
 * anybody touching it. On a 12-hour session this matters more than usual: the rider is
 * signed in for the whole shift precisely so they are never signed out mid-round, and an
 * accidental sign-out at the wrong moment is the failure that trade was made to avoid.
 *
 * QUIET, AND AT THE BOTTOM. It is the only control on this surface that a rider never
 * wants to press by accident, so it does not get the primary colour, it does not get
 * `block`, and it is not near the status control. `Button`'s `md` size is still 44px —
 * `--touch-min` — because packages/ui has no size below the touch floor.
 *
 * The name is beside it because a rider may be using a shared handset, and "signed in as
 * somebody else" is otherwise invisible until a delivery they do not recognise appears.
 *
 * IT NO LONGER PUSHES ITSELF DOWN THE PAGE. This carried `marginTop: var(--space-7)`, which
 * is the row deciding how far it sits from whatever happens to be above it — and there are
 * three different things above it depending on the route and the session state. `FieldShell`
 * wraps the main column in a `Stack`, so the gap between siblings is one decision made once
 * by the column rather than a margin each sibling remembers to carry.
 */
export function SignOutButton({ name }: { name: string }) {
  return (
    <form action={submitSignOut} className="row-wrap">
      <span className="muted grow">Signed in as {name}</span>
      <Button type="submit" variant="quiet">
        Sign out
      </Button>
    </form>
  )
}

async function submitSignOut() {
  'use server'

  const { redirect } = await import('next/navigation')

  await signOut()

  redirect('/sign-in')
}
