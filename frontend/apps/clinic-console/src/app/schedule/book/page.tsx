import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { ConsoleShell } from '@/components/ConsoleShell'
import { AssistedBooking, currentStaff } from '@/domains/scheduling'
import { SCHEDULE_PATHS } from '../paths'

/**
 * Front-desk assisted booking.
 *
 * The same three responsibilities as the day view and nothing else: the session, the forced
 * password change, and the frame with its section named. Every query parameter is read off the
 * URL and handed over unaltered — what each means, and which values are safe, belongs to the
 * domain that renders them.
 *
 * `active="schedule"` even though this is not the section's own route. It is a screen of the
 * schedule, and a nav that unhighlighted itself when a receptionist opened the booking form
 * would tell them they had left the section they are plainly still in.
 */
export const metadata: Metadata = { title: 'Book for a caller' }

export default async function BookPage({
  searchParams,
}: {
  searchParams: Promise<{
    patient?: string
    service?: string
    clinician?: string
    day?: string
    q?: string
    problem?: string
    message?: string
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
    <ConsoleShell title="Book for a caller" active="schedule">
      <AssistedBooking
        staff={staff}
        paths={SCHEDULE_PATHS}
        patientId={params.patient}
        serviceId={params.service}
        clinicianId={params.clinician}
        day={params.day}
        query={params.q}
        problem={params.problem}
        message={params.message}
      />
    </ConsoleShell>
  )
}
