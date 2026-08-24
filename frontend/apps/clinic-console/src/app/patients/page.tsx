import type { Metadata } from 'next'
import { ConsoleShell } from '@/components/ConsoleShell'
import { RegistryScreen } from '@/domains/patients'
import { PATIENTS_PATHS } from './paths'

/**
 * The registry.
 *
 * EVERY SEARCH PARAMETER IS CARRIED, NOT INTERPRETED. `status`, `find`, `cursor` and `done` are
 * read off the URL and handed over exactly as they arrived. Which statuses are real, what
 * `find` narrows and which values of `done` are worth confirming are the domain's business and
 * are decided there against closed sets — a route that started translating them into props with
 * meanings of its own would be the registry's rules restated in the routing tree, free to drift
 * from the screen that enforces them.
 *
 * THE TITLE IS STATIC AND STAYS STATIC. It is tempting to put a filter or a count in it; a
 * browser tab and a history entry are both readable over somebody's shoulder at a front desk,
 * and neither is a place for anything about who this clinic is treating.
 *
 * NO AUTHORISATION HAPPENS HERE, and that is a gap rather than a decision. `PatientPolicy`
 * admits administrator, clinician and front desk to the registry, but this console has no
 * session surface yet — `src/domains/identity` is still an empty placeholder — so there is
 * nothing to ask. The API is the control: an unauthorised session gets a 403 and the screen
 * renders the API's own sentence rather than an empty table. See the handover note.
 */
export const metadata: Metadata = { title: 'Patients' }

export default async function PatientsPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string
    find?: string
    cursor?: string
    done?: string
  }>
}) {
  const params = await searchParams

  return (
    <ConsoleShell title="Patients" active="patients">
      <RegistryScreen
        paths={PATIENTS_PATHS}
        status={params.status}
        find={params.find}
        cursor={params.cursor}
        done={params.done}
      />
    </ConsoleShell>
  )
}
