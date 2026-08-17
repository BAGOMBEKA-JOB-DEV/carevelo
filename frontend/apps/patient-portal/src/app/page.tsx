import { resolveTenant } from '@/lib/tenant'

/**
 * The portal's front door.
 *
 * Deliberately thin: a route composes domains and holds no logic of its own, which
 * the boundary rules enforce. The booking flow arrives in the next phase, in
 * src/domains/scheduling.
 */
export default async function HomePage() {
  const tenant = await resolveTenant()

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Book a consultation</h1>
          <p>See a clinician at {tenant.trading_name ?? 'this clinic'} by video, voice or chat.</p>
        </div>
      </div>

      <div className="card">
        <p className="subtitle">
          Booking opens here once the scheduling domain lands. This page exists to prove the
          shell, the tokens and the server-rendered branding.
        </p>
      </div>
    </>
  )
}
