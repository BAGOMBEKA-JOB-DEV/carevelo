import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { ConsoleShell } from '@/components/ConsoleShell'
import { MergeScreen, tryReadPatient } from '@/domains/patients'
import { PATIENTS_PATHS } from '../../paths'

/**
 * Merging a duplicate registration into this record.
 *
 * THE RECORD IN THE URL IS THE SURVIVOR. That is the API's own arrangement —
 * `MergePatientRequest` puts the survivor in the route and the duplicate in the body, because
 * the survivor is the record the desk already had open — and the route preserves it rather than
 * inventing a friendlier one. Getting it the wrong way round loses the wrong history and there
 * is no unmerge.
 *
 * `?duplicate=` IS THE ONLY PIECE OF STATE BETWEEN THE TWO STEPS, and it is a record identifier
 * in a URL, which on this surface is already the norm — the path above it is one too. The screen
 * reads that record itself and renders a notice rather than a not-found if it cannot, because
 * the SURVIVOR is perfectly readable and the desk should land back on the chooser rather than on
 * an error page for a record they still have open.
 */
export const metadata: Metadata = { title: 'Merge a duplicate' }

export default async function PatientMergePage({
  params,
  searchParams,
}: {
  params: Promise<{ patient: string }>
  searchParams: Promise<{ duplicate?: string; cursor?: string; error?: string }>
}) {
  const [{ patient: patientId }, query] = await Promise.all([params, searchParams])

  const survivor = await tryReadPatient(patientId)

  if (survivor === null) {
    notFound()
  }

  return (
    <ConsoleShell title="Merge a duplicate" active="patients">
      <MergeScreen
        paths={PATIENTS_PATHS}
        survivor={survivor}
        duplicate={query.duplicate}
        cursor={query.cursor}
        error={query.error}
      />
    </ConsoleShell>
  )
}
