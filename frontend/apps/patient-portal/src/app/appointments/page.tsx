import { redirect } from 'next/navigation'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { AppointmentsScreen } from '@/domains/scheduling'
import { SiteShell } from '@/components/SiteShell'
import { SCHEDULING_PATHS } from '../paths'

/**
 * What this patient has booked.
 *
 * EVERY SEARCH PARAMETER IS CARRIED, NOT INTERPRETED. `past`, `cursor`, `booked`,
 * `cancelled`, `problem` and `message` are read off the URL and handed to the screen
 * exactly as they arrived; what `problem=cancel_failed` means, and which of them are safe
 * to render, is the scheduling domain's business and is decided there against a closed set.
 * A route that started translating these into props with meanings of its own would be the
 * booking rules restated in the routing tree, free to drift from the screen they govern.
 *
 * `?past=1` AND `?cancelled=1` ARE COMPARED AGAINST THE LITERAL `'1'` rather than coerced,
 * because every other string — including `0`, `false` and an empty value — must read as
 * "no". `Boolean('0')` is `true`, and a patient who followed a stale link would be shown
 * their history instead of what is coming.
 *
 * CURSOR PAGINATION IS THE ONLY PAGINATION HERE. There is no page number to plumb because
 * the API pages by cursor: the clinic is booking into the same table while the patient
 * reads it, and that is precisely the traffic under which an offset duplicates and skips
 * rows. A skipped row here is an appointment somebody never sees.
 */
export default async function AppointmentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    past?: string
    cursor?: string
    booked?: string
    cancelled?: string
    problem?: string
    message?: string
  }>
}) {
  const [tenant, user, params] = await Promise.all([
    resolveTenant(),
    currentUser(),
    searchParams,
  ])

  // The same two redirects as app/account/page.tsx, and for the same reasons.
  if (!user) {
    redirect('/sign-in')
  }

  if (user.password_change_required) {
    redirect('/set-password')
  }

  return (
    <SiteShell tenant={tenant} signedIn>
      <AppointmentsScreen
        tenant={tenant}
        paths={SCHEDULING_PATHS}
        past={params.past === '1'}
        cursor={params.cursor}
        booked={params.booked}
        cancelled={params.cancelled === '1'}
        problem={params.problem}
        message={params.message}
      />
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
