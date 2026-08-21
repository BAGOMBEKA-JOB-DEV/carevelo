import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ConsoleShell } from '@/components/ConsoleShell'
import { ConsentDeskScreen, tryReadPatient } from '@/domains/patients'
import { PATIENTS_PATHS } from '../../paths'

/**
 * Consent capture at the desk.
 *
 * `policy` IS THE LANGUAGE THE PATIENT READS, and it is the one search parameter on this
 * surface that exists for somebody other than the member of staff operating it. The console's
 * chrome is English — only the patient portal is required to be bilingual — but the consent
 * policy is not chrome. It is the document the patient is being asked to agree to, and consent
 * obtained from wording they did not understand is not consent, so the screen offers whichever
 * languages the API published the policy in and this route carries the choice.
 *
 * It is carried, not interpreted. The screen narrows it against the languages the policy
 * actually came back in; a route that validated it here would be a second, drifting copy of a
 * list only the API knows.
 *
 * The record is read here so a record that is not this clinic's is a 404 before any consent
 * form is rendered.
 */
export const metadata: Metadata = { title: 'Consent' }

export default async function PatientConsentPage({
  params,
  searchParams,
}: {
  params: Promise<{ patient: string }>
  searchParams: Promise<{ policy?: string; error?: string; done?: string }>
}) {
  const [{ patient: patientId }, query] = await Promise.all([params, searchParams])

  const patient = await tryReadPatient(patientId)

  if (patient === null) {
    notFound()
  }

  return (
    <ConsoleShell title="Consent" active="patients">
      <ConsentDeskScreen
        paths={PATIENTS_PATHS}
        patient={patient}
        language={query.policy}
        error={query.error}
        done={query.done}
      />
    </ConsoleShell>
  )
}
