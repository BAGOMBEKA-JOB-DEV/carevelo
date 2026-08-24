import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ConsoleShell } from '@/components/ConsoleShell'
import { PatientDetailsScreen, tryReadPatient } from '@/domains/patients'
import { PATIENTS_PATHS } from '../../paths'

/**
 * Correcting a patient's contact and demographic details.
 *
 * The record is read here so that a record which is not this clinic's is a 404 before a form is
 * ever rendered — see the note on the record route about why 404 and 403 arrive as the same
 * answer. The screen prefills every control from what comes back, which is what makes an
 * emptied box mean "remove this" rather than "not supplied".
 *
 * `error` and `field` come back from a failed save and are passed through untouched: the API
 * wrote the sentence, the screen decides which control it lands on.
 *
 * The title names the action rather than the patient, for the reason set out on the record
 * route: a browser tab is readable over somebody's shoulder at a front desk.
 */
export const metadata: Metadata = { title: 'Correct details' }

export default async function PatientDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ patient: string }>
  searchParams: Promise<{ error?: string; field?: string }>
}) {
  const [{ patient: patientId }, query] = await Promise.all([params, searchParams])

  const patient = await tryReadPatient(patientId)

  if (patient === null) {
    notFound()
  }

  return (
    <ConsoleShell title="Correct details" active="patients">
      <PatientDetailsScreen
        paths={PATIENTS_PATHS}
        patient={patient}
        error={query.error}
        field={query.field}
      />
    </ConsoleShell>
  )
}
