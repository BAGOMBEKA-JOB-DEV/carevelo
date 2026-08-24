import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { Notice } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'
import { currentStaff } from '@/domains/scheduling'
import { ConsultationRoom, loadRoom } from '@/domains/consultations'
import { PrescribingPanel } from '@/domains/prescriptions'
import { SCHEDULE_PATHS } from '../../paths'

/**
 * THE CONSULTATION ROOM — and the one route in this change that composes three domains.
 *
 * ------------------------------------------------------------------------------------
 * WHAT COMPOSITION MEANS HERE, EXACTLY
 *
 * `.dependency-cruiser.cjs` forbids a domain reaching into another domain's internals and says
 * why: "Reaching inside makes two domains one domain with a folder between them." So the
 * consultations domain does not import the prescribing form, and the prescriptions domain does
 * not know what a consultation room looks like. THIS FILE is where the two meet:
 * `<ConsultationRoom>` exposes a `prescribing` slot, and this route fills it with
 * `<PrescribingPanel>`.
 *
 * The scheduling domain contributes the session — `currentStaff()` — which the room needs for
 * the note draft's storage key and the panel needs to look up the prescriber. That is also a
 * composition rather than a cross-domain import: the route reads it once and passes the value
 * down as a prop, so neither of the other two domains knows where identity comes from. When the
 * identity domain lands, one import on this line changes and nothing else does.
 *
 * ------------------------------------------------------------------------------------
 * THE ROLE CHECK THAT HAPPENS HERE AND NOWHERE ELSE
 *
 * `AppointmentPolicy::join` admits the clinician holding the consultation and the patient, and
 * DELIBERATELY EXCLUDES THE ADMINISTRATOR: "they may read that a consultation happened, which
 * the audit trail gives them, but sitting in on one is a different act entirely and no clinic
 * asked for it."
 *
 * So an administrator or a receptionist who follows a link to this URL is told plainly that
 * this is not a screen for them, rather than being shown a door that answers 403. That is a
 * ROUTE decision and not a security boundary — the API is the boundary, and it holds whatever
 * this page renders.
 *
 * ------------------------------------------------------------------------------------
 * WHY THE OUTCOME IS PULLED OUT AND PASSED TO THE PANEL
 *
 * Prescribing is blocked unless the consultation ended with the outcome `completed` — every
 * other outcome, and the null outcome of a live consultation, fails
 * `ConsultationOutcome::permitsPrescribing()`. The panel renders the reason instead of a form,
 * and it needs the outcome to do it. Reading it here rather than having the panel fetch the
 * consultation again keeps the audited read count at one per screen.
 */
export const metadata: Metadata = { title: 'Consultation' }

export default async function ConsultationRoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ appointment: string }>
  searchParams: Promise<{ problem?: string; message?: string }>
}) {
  const [staff, { appointment }, query] = await Promise.all([
    currentStaff(),
    params,
    searchParams,
  ])

  if (staff === null) {
    redirect('/sign-in')
  }

  if (staff.password_change_required) {
    redirect('/set-password')
  }

  if (!staff.roles.includes('clinician')) {
    return (
      <ConsoleShell title="Consultation" active="schedule">
        <Notice tone="warn" icon="lock" title="This is a clinician’s screen">
          Only the clinician holding a consultation and the patient may enter the room. An
          administrator can see that a consultation took place, and what its outcome was, from
          the schedule and the audit trail — but sitting in on one is a different act, and the
          clinic&rsquo;s server would refuse it.
        </Notice>
      </ConsoleShell>
    )
  }

  const state = await loadRoom(appointment)

  const consultation = state.kind === 'door' || state.kind === 'open' ? state.consultation : null
  const patient = state.kind === 'unavailable' ? null : state.patient

  return (
    <ConsoleShell title="Consultation" active="schedule">
      <ConsultationRoom
        state={state}
        paths={{ room: SCHEDULE_PATHS.room, day: SCHEDULE_PATHS.day }}
        userId={staff.id}
        problem={query.problem}
        message={query.message}
        prescribing={
          consultation === null || patient === null ? null : (
            <PrescribingPanel
              consultationId={consultation.id}
              patientId={patient.id}
              patientName={`${patient.given_name} ${patient.family_name}`.trim()}
              appointmentId={appointment}
              userId={staff.id}
              userName={staff.name}
              outcome={consultation.outcome}
              paths={{ room: SCHEDULE_PATHS.room }}
            />
          )
        }
      />
    </ConsoleShell>
  )
}
