import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ConsoleShell } from '@/components/ConsoleShell'
import { PatientRecordScreen, tryReadPatient } from '@/domains/patients'
import { PATIENTS_PATHS } from '../paths'

/**
 * One patient's record.
 *
 * THE ROUTE'S ONE JOB IS THE READ, AND THE 404. `tryReadPatient` answers `null` for a record
 * that does not exist AND for one belonging to another clinic — the API returns 404 rather than
 * 403 for the second case precisely so that nobody can learn a named person is a patient of a
 * named clinic from the shape of a refusal, and a frontend that distinguished the two would
 * hand that distinction straight back. Both become `notFound()` here.
 *
 * THE PATIENT'S NAME IS NOT IN THE TITLE, AND THAT IS DELIBERATE. Every other route in this
 * console names what it is showing; this one cannot. A browser tab, a history entry and a
 * bookmark bar are all readable over somebody's shoulder at a front desk, and "Fatuma Nakato ·
 * Clinic console" in any of them discloses that a named person is a patient here — which is
 * exactly the fact the 404-not-403 rule above exists to protect. The record identifier stays in
 * the URL because a receptionist has to be able to return to a record, and an opaque ULID
 * discloses nothing to a passer-by.
 *
 * READING THIS IS AUDITED. `PatientController::show` writes a `patient.viewed` event on every
 * call, because the consent policy promises the patient in writing that every staff access is
 * recorded. So the read happens once, here, for a page that is actually going to be rendered —
 * never speculatively and never to decide whether to show a link.
 */
export const metadata: Metadata = { title: 'Patient record' }

export default async function PatientRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ patient: string }>
  searchParams: Promise<{ done?: string; error?: string }>
}) {
  const [{ patient: patientId }, query] = await Promise.all([params, searchParams])

  const patient = await tryReadPatient(patientId)

  if (patient === null) {
    notFound()
  }

  return (
    <ConsoleShell title="Patient record" active="patients">
      <PatientRecordScreen
        paths={PATIENTS_PATHS}
        patient={patient}
        done={query.done}
        error={query.error}
      />
    </ConsoleShell>
  )
}
