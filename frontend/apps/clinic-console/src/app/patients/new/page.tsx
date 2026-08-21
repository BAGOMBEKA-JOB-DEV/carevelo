import type { Metadata } from 'next'
import { ConsoleShell } from '@/components/ConsoleShell'
import { RegisterScreen } from '@/domains/patients'
import { PATIENTS_PATHS } from '../paths'

/**
 * Registering a walk-in.
 *
 * `error` AND `field` COME BACK FROM A FAILED SUBMISSION and are the only state that survives
 * it — the values the receptionist typed deliberately do not, because the only ways to carry
 * them across a native form post are the URL and a cookie, and a patient's name and phone
 * number belong in neither on a shared terminal. The screen explains that where it matters.
 *
 * Both are passed through untouched. The API wrote the sentence; the screen decides which
 * control it lands on.
 */
export const metadata: Metadata = { title: 'Register a patient' }

export default async function RegisterPatientPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; field?: string }>
}) {
  const params = await searchParams

  return (
    <ConsoleShell title="Register a patient" active="patients">
      <RegisterScreen paths={PATIENTS_PATHS} error={params.error} field={params.field} />
    </ConsoleShell>
  )
}
