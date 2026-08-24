import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { DeliveryList, listDeliveries } from '@/domains/delivery'
import { SiteShell } from '@/components/SiteShell'
import { PageBody } from '@/components/PageBody'

/**
 * What is on its way to this patient.
 *
 * THIS ROUTE IS THE WHOLE POINT OF THE PATIENT BRANCH ON `DeliveryController::index()`.
 * The tracking screen at /deliveries/[delivery] has existed for some time and nobody could
 * reach it: `DeliveryPolicy::viewOwn()` admitted a patient and nothing called it, the
 * listing authorised `viewAny`, and so a patient could follow a package only if they
 * already held its identifier — which arrived in a message from the clinic, or not at all.
 * This is where that identifier now comes from.
 *
 * THE TWO REDIRECTS ARE THE ONES /account MAKES, asked of the API rather than read off the
 * cookie: a cookie cannot know it has been invalidated by a deactivation, and the API
 * refuses every other authenticated request while `password_change_required` stands.
 *
 * THE READ IS HERE AND THE RENDERING IS NOT. `listDeliveries` returns a result object
 * rather than throwing, and `DeliveryList` renders every branch of it — the page, the empty
 * state, the failure. That split keeps this file free of logic while letting the route own
 * the fetch, on the render Next can actually stream.
 *
 * `?cursor=` IS THE ONLY PAGINATION AND THERE IS NO PAGE NUMBER, because the backend pages
 * the patient branch by cursor. The dispatcher is assigning and riders are moving packages
 * through the same table while the patient reads it, which is exactly the traffic under
 * which an offset paginator duplicates and skips rows — and a skipped row here is a
 * delivery nobody goes to the gate for.
 *
 * NOTHING HERE CACHES, AND NOTHING HERE MAY. A delivery list served from a cache tells a
 * patient their medicine is still at the pharmacy while the rider is at their gate. The
 * page is dynamic already because the read forwards a session cookie; the rule is written
 * down so nobody adds `revalidate` to make the list feel faster.
 *
 * NO CLINIC TELEPHONE NUMBER IS PASSED, UNLIKE THE TRACKING PAGE, and that is deliberate
 * rather than an oversight. The number is on that screen because a FAILED delivery has no
 * patient-callable reschedule and the clinic is the only way to arrange another attempt.
 * A list is not where that conversation starts: it does not show `failure_reason`, so it
 * has nothing to offer the number about, and `SiteFooter` carries the clinic's real number
 * as a `tel:` link at the foot of every shelled page regardless.
 */
export default async function DeliveriesPage({
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

  const result = await listDeliveries({ cursor })

  return (
    <SiteShell tenant={tenant} signedIn>
      <PageBody>
        <DeliveryList
          result={result}
          clinic={tenant.trading_name ?? common('thisClinic')}
          basePath="/deliveries"
        />
      </PageBody>
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
