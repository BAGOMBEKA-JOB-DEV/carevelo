import Link from 'next/link'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'

/**
 * The portal's front door: a sign-in prompt for a guest, and the patient's own care for
 * somebody signed in.
 *
 * Server-rendered, so the clinic's branding is in the first HTML byte and a patient on a
 * slow connection sees their clinic — not a spinner, and never a flash of Carevelo's
 * colours where the clinic's should be.
 */
export default async function HomePage() {
  const [tenant, user] = await Promise.all([resolveTenant(), currentUser()])
  const clinic = tenant.trading_name ?? 'this clinic'

  if (!user) {
    return (
      <>
        <div className="page-head">
          <div className="grow">
            <h1>Book a consultation</h1>
            <p>See a clinician at {clinic} by video, voice or chat.</p>
          </div>
        </div>

        <div className="card card-brand">
          <p className="lede">Sign in with your phone number to book and to see your care.</p>
          <Link className="btn btn-brand btn-lg" href="/sign-in" style={{ marginTop: 'var(--space-5)' }}>
            Sign in
          </Link>
        </div>
      </>
    )
  }

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Welcome back</h1>
          <p>
            Signed in as {user.name} at {clinic}.
          </p>
        </div>
      </div>

      <div className="grid g-2">
        <div className="card">
          <div className="stat">
            <span className="stat__label">Your clinic</span>
            <span className="stat__value" style={{ fontSize: 21 }}>
              {clinic}
            </span>
            <span className="stat__note">{tenant.contact?.phone ?? ''}</span>
          </div>
        </div>

        <div className="card">
          <div className="stat">
            <span className="stat__label">Signed in as</span>
            <span className="stat__value" style={{ fontSize: 21 }}>
              {user.name}
            </span>
            <span className="stat__note tnum">{'phone' in user ? user.phone : ''}</span>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: 'var(--space-6)' }}>
        <p className="subtitle">
          Booking, your prescriptions and delivery tracking arrive in the next phase. The
          session above is real: it was issued by the API and every request from this page
          carries it.
        </p>
      </div>
    </>
  )
}
