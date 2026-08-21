import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ConsoleShell } from '@/components/ConsoleShell'
import { IssueAccountScreen, tryReadPatient } from '@/domains/patients'
import { PATIENTS_PATHS } from '../../paths'

/**
 * Issuing a patient their portal account.
 *
 * NO SEARCH PARAMETERS AT ALL, AND THAT IS THE POINT OF THIS ROUTE. Every other screen in the
 * domain carries its outcome back in the URL; this one must not, because its outcome is a
 * password that exists in exactly one place — the body of the response that created it. A query
 * string would put it in browser history on a shared terminal, in the console's access logs, in
 * any proxy in front of it and in the next request's Referer header. The screen renders the
 * result in place instead, which is why the small form inside it is the one 'use client' in the
 * domain.
 *
 * There is nothing to pass through here and nothing to remember. If the page is reloaded, the
 * password is gone — correctly, and the screen says so before the button is pressed.
 *
 * The record is read here so that a record which is not this clinic's is a 404 before the screen
 * decides anything, and so the screen can refuse — no email address, an account already issued,
 * a registration that ended — with the reason in front of the desk rather than after a submit.
 */
export const metadata: Metadata = { title: 'Portal account' }

export default async function IssueAccountPage({
  params,
}: {
  params: Promise<{ patient: string }>
}) {
  const { patient: patientId } = await params

  const patient = await tryReadPatient(patientId)

  if (patient === null) {
    notFound()
  }

  return (
    <ConsoleShell title="Portal account" active="patients">
      <IssueAccountScreen paths={PATIENTS_PATHS} patient={patient} />
    </ConsoleShell>
  )
}
