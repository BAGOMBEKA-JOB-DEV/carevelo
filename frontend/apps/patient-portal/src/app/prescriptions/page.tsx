import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { listPrescriptions, PrescriptionList } from '@/domains/prescriptions'
import { SiteShell } from '@/components/SiteShell'
import { PageBody } from '@/components/PageBody'

/**
 * What has been prescribed for this patient.
 *
 * CLINICAL CONTENT, SO THE SESSION CHECK IS THE POINT OF THIS FILE. The product's rule is
 * that clinical content is shown in-app under authentication and never in a notification;
 * this is the in-app half of it. The two redirects are the ones /account already makes —
 * asked of the API rather than read off the cookie, because a cookie cannot know it has
 * been invalidated by a deactivation, and because the API refuses every other authenticated
 * request while `password_change_required` stands.
 *
 * THE READ IS HERE AND THE RENDERING IS NOT. `listPrescriptions` returns a result object
 * rather than throwing, and `PrescriptionList` renders every branch of it — the page, the
 * empty state, the failure. That split is what keeps this file free of logic while still
 * letting the route own the one thing a route must own: the fetch, on the render Next can
 * actually stream.
 *
 * `?cursor=` IS THE ONLY PAGINATION AND THERE IS NO PAGE NUMBER, because the backend pages
 * this by cursor. An offset paginator skips rows when new prescriptions arrive mid-read,
 * and a skipped row here is a prescription nobody dispenses.
 *
 * THE CLINIC'S NAME, NOT THE TENANT OBJECT, is what the component takes — which is why the
 * fallback is resolved here. It keeps the domain free of `@/lib` and rendering it in a test
 * a matter of passing a string.
 */
export default async function PrescriptionsPage({
  searchParams,
}: {
  searchParams: Promise<{ cursor?: string }>
}) {
  const [tenant, user, common, { cursor }] = await Promise.all([
    resolveTenant(),
    currentUser(),
    getTranslations('Common'),
    searchParams,
  ])

  if (!user) {
    redirect('/sign-in')
  }

  if (user.password_change_required) {
    redirect('/set-password')
  }

  const result = await listPrescriptions({ cursor })

  return (
    <SiteShell tenant={tenant} signedIn>
      <PageBody>
        <PrescriptionList
          result={result}
          clinic={tenant.trading_name ?? common('thisClinic')}
          basePath="/prescriptions"
        />
      </PageBody>
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
