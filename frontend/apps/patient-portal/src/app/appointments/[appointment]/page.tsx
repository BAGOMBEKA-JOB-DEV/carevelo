import { redirect } from 'next/navigation'
import { clinicMetadata } from '@/lib/metadata'
import { consultationHref } from '@/domains/consultations'

/**
 * One appointment, by identifier.
 *
 * THIS ROUTE IS AN ALIAS, AND THAT IS THE HONEST ANSWER TO A GAP RATHER THAN A CLEVERNESS.
 * The scheduling domain exports three screens — the catalogue, the booking journey and the
 * list — and no detail screen; `AppointmentsScreen` is where an appointment is read, with
 * its hold countdown, its "pay now" and its cancel control all on the row. Building a
 * per-appointment page here would mean laying out an appointment in the routing tree, which
 * is precisely the business-logic-in-app/ that `.dependency-cruiser.cjs` forbids and a
 * reviewer would rightly stop.
 *
 * There IS already a per-appointment page in this product, and it belongs to a different
 * domain: `/consultations/{id}`, which the consultations domain owns and which is the
 * `{join_link}` in the confirmation SMS, the lobby, the room, and the resume link after a
 * dropped call. It renders the appointment's own state whatever that state is — cancelled,
 * not yet confirmed, not open yet, finished — and calls `notFound()` itself for an
 * appointment that is not this patient's. So an `/appointments/{id}` somebody types, or
 * pastes from a message, lands on the page that can actually answer for it.
 *
 * NO SESSION CHECK AND NO READ HERE, on purpose. Adding either would duplicate what the
 * destination already does — `ConsultationScreen` resolves the appointment under the
 * caller's own session and 404s for anyone else's — and a read performed only to decide
 * whether to redirect is a round trip on a handset that buys nothing. The redirect leaks
 * nothing either way: it happens for an identifier that exists and for one that never did.
 *
 * WHAT WOULD REPLACE THIS. An `AppointmentDetail` export from the scheduling domain, at
 * which point this file renders it and the consultation link becomes one control on it.
 */
export default async function AppointmentPage({
  params,
}: {
  params: Promise<{ appointment: string }>
}) {
  const { appointment } = await params

  // Built by the domain rather than typed out, so this route cannot drift from the path
  // the SMS template and the front desk both hand out. See domains/consultations/api/paths.ts.
  redirect(consultationHref(appointment))
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
