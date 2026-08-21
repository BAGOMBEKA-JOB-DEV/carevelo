import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { getPrescription, PrescriptionDetail } from '@/domains/prescriptions'
import { SiteShell } from '@/components/SiteShell'

/**
 * One prescription: what was prescribed, how to take it, and the written document.
 *
 * A NOT-FOUND IS A NOT-FOUND AND MUST NOT BE EXPLAINED. A prescription belonging to another
 * patient — of this clinic or of any other — answers 404 exactly as one that never existed
 * does, because the API refuses to confirm that a record exists elsewhere. This route
 * therefore renders the portal's own 404 for `result.notFound` and has no branch that could
 * say "that belongs to a different clinic". Recovering that distinction on an error page is
 * how the isolation boundary leaks back out.
 *
 * A FAILURE THAT IS NOT A 404 IS NOT A 404 EITHER. `result.notFound` is false for a network
 * failure or a 500, and that case falls through to the component, which says the
 * prescription could not be fetched. Rendering the missing page for an outage would tell a
 * patient their prescription had been withdrawn.
 *
 * `selfHref` EXISTS BECAUSE A SERVER ACTION DOES NOT KNOW WHERE IT WAS POSTED FROM. The
 * document button posts to an action inside the domain; when the render has not landed yet
 * the action redirects back here with `?document=rendering`, which arrives as
 * `documentState` below. The signed URL itself is never exported and never reaches this
 * file: it is a 300-second bearer credential for health data, and a route holding one would
 * bake an expiring credential into the HTML.
 *
 * ANY OTHER `?document=` VALUE IS NO STATE AT ALL. A search parameter is under the control
 * of whoever wrote the link, so the two the domain defines are matched exactly and
 * everything else becomes `undefined`.
 */
export default async function PrescriptionPage({
  params,
  searchParams,
}: {
  params: Promise<{ prescription: string }>
  searchParams: Promise<{ document?: string }>
}) {
  const [tenant, user, common, { prescription }, query] = await Promise.all([
    resolveTenant(),
    currentUser(),
    getTranslations('Common'),
    params,
    searchParams,
  ])

  if (!user) {
    redirect('/sign-in')
  }

  if (user.password_change_required) {
    redirect('/set-password')
  }

  const result = await getPrescription(prescription)

  if (!result.ok && result.notFound) {
    notFound()
  }

  const selfHref = `/prescriptions/${encodeURIComponent(prescription)}`

  return (
    <SiteShell tenant={tenant} signedIn>
      <div className="site-wrap" style={{ paddingBlock: 'var(--space-8)' }}>
        <PrescriptionDetail
          result={result}
          clinic={tenant.trading_name ?? common('thisClinic')}
          selfHref={selfHref}
          backHref="/prescriptions"
          documentState={
            query.document === 'rendering' || query.document === 'unavailable'
              ? query.document
              : undefined
          }
        />
      </div>
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
