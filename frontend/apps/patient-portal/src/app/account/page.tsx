import { redirect } from 'next/navigation'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { signOut } from '@/domains/identity'
import { SiteShell } from '@/components/SiteShell'

/**
 * Where a signed-in person lands.
 *
 * A GUEST IS REDIRECTED, not shown an empty page: this route exists only for somebody
 * with a session, and the check asks the API rather than reading the cookie, because a
 * cookie cannot know it has been invalidated by a deactivation or a role change.
 *
 * Booking, prescriptions and delivery tracking arrive in the next phase and this page says
 * so in as many words. What it does not do is show a plausible empty state for a feature
 * that does not exist — a patient waiting on a delivery card that will never populate is
 * worse served than one told plainly.
 */
export default async function AccountPage() {
  const [tenant, user] = await Promise.all([resolveTenant(), currentUser()])

  if (!user) {
    redirect('/sign-in')
  }

  const clinic = tenant.trading_name ?? 'this clinic'

  return (
    <SiteShell tenant={tenant} signedIn>
      <div className="site-wrap" style={{ paddingBlock: 'var(--space-8)' }}>
        <div className="page-head">
          <div className="grow">
            <span className="site-eyebrow">Your care</span>
            <h1 style={{ marginTop: 'var(--space-4)' }}>Welcome back, {firstName(user.name)}.</h1>
            <p>You are signed in to {clinic}.</p>
          </div>

          {/* A form, not a link: signing out changes state and must not be reachable by
              anything that prefetches. */}
          <form action={endSession}>
            <button className="btn btn-ghost" type="submit">
              Sign out
            </button>
          </form>
        </div>

        <div className="site-features" style={{ marginTop: 'var(--space-7)' }}>
          <div className="site-feature">
            <div className="stat">
              <span className="stat__label">Your clinic</span>
              <span className="stat__value" style={{ fontSize: 21 }}>
                {clinic}
              </span>
              <span className="stat__note tnum">{tenant.contact?.phone ?? ''}</span>
            </div>
          </div>

          <div className="site-feature">
            <div className="stat">
              <span className="stat__label">Signed in as</span>
              <span className="stat__value" style={{ fontSize: 21 }}>
                {user.name}
              </span>
              <span className="stat__note tnum">{user.phone ?? ''}</span>
            </div>
          </div>

          <div className="site-feature">
            <div className="stat">
              <span className="stat__label">Next step</span>
              <span className="stat__value" style={{ fontSize: 21 }}>
                Book a consultation
              </span>
              <span className="stat__note">Arriving in the next release.</span>
            </div>
          </div>
        </div>

        <div className="notice notice-info" style={{ marginTop: 'var(--space-7)' }}>
          Booking, your prescriptions and delivery tracking are being built. The session
          above is real: it was issued by {clinic}&apos;s API and every request this page
          makes carries it.
        </div>
      </div>
    </SiteShell>
  )
}

async function endSession() {
  'use server'

  const { redirect: go } = await import('next/navigation')

  await signOut()

  go('/')
}

/** The name people answer to. A full legal name in a greeting reads like a summons. */
function firstName(name: string): string {
  return name.split(' ')[0] ?? name
}
