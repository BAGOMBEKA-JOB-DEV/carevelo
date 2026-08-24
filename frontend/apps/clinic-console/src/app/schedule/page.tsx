import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { ConsoleShell } from '@/components/ConsoleShell'
import { currentStaff, DayView } from '@/domains/scheduling'
import { SCHEDULE_PATHS } from './paths'

/**
 * The clinician's day.
 *
 * THIN BY DESIGN. A route composes domains, resolves the session and renders; it holds no
 * logic, and `.dependency-cruiser.cjs` enforces that a domain can never import from `src/app`.
 * Everything on this page — which day, which clinician, what the rows mean, what the actions
 * do — belongs to `<DayView>`.
 *
 * WHAT A ROUTE IS STILL RESPONSIBLE FOR, AND IT IS EXACTLY THREE THINGS:
 *
 *   1. Who is signed in. A guest goes to sign-in; there is no other honest answer for a
 *      console behind authentication.
 *   2. Somebody who must change their password changes it first. `MeResource.password_change_required`
 *      is non-null when every endpoint but that one and sign-out is refused, so rendering a
 *      schedule for them would render a page of failed reads.
 *   3. The frame, with the section named. `ConsoleShell` requires `active` and this page is the
 *      `schedule` section — a page that did not say so would render six nav links none of which
 *      could be current.
 *
 * THE SIGN-IN AND SET-PASSWORD ROUTES DO NOT EXIST ON THIS CONSOLE YET. The identity domain is
 * an empty placeholder that this change does not own. These redirects name the paths the
 * patient portal already uses, so that when the console's own sign-in lands there is nothing to
 * rewire — and until then an unauthenticated visitor gets a 404 at `/sign-in`, which is a
 * visible, honest failure rather than a schedule rendered out of empty reads.
 */
export const metadata: Metadata = { title: 'Schedule' }

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{
    day?: string
    clinician?: string
    problem?: string
    message?: string
    done?: string
  }>
}) {
  const [staff, params] = await Promise.all([currentStaff(), searchParams])

  if (staff === null) {
    redirect('/sign-in')
  }

  if (staff.password_change_required) {
    redirect('/set-password')
  }

  return (
    <ConsoleShell title="Schedule" active="schedule">
      <DayView
        staff={staff}
        paths={SCHEDULE_PATHS}
        day={params.day}
        clinicianId={params.clinician}
        problem={params.problem}
        message={params.message}
        done={params.done}
      />
    </ConsoleShell>
  )
}
