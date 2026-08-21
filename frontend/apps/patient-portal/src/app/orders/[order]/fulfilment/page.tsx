import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { FulfilmentChoice, getDispenseOrder } from '@/domains/delivery'
import { SiteShell } from '@/components/SiteShell'

/**
 * Collecting your medicines, or having them brought to you.
 *
 * REACHED FROM A LINK THE CLINIC SENT, and that is a platform gap rather than a design
 * choice. `DispenseOrderController::index()` authorises `viewAny`, which is clinic staff
 * only, and does not use `AuthorisesPatientReads` — although `DispenseOrderPolicy::viewOwn`
 * exists, unused. So a patient can open an order they hold the identifier for and cannot
 * discover that identifier from any endpoint they may call. There is consequently no "my
 * orders" list anywhere in this portal, and the account hub says so in as many words rather
 * than showing an empty card that will never populate.
 *
 * ---------------------------------------------------------------------------------------
 * `deliveryConsent`, WHICH IS THE ONE PROP THIS ROUTE CANNOT SATISFY HONESTLY YET.
 *
 * The delivery domain asks for two things: whether a `delivery_disclosure` consent stands
 * for this patient right now, and the page that CAPTURES that consent. Neither exists:
 *
 *   - The patients domain exports no `hasDeliveryDisclosure()` reader. Its own report names
 *     one as the intended shape and it is not on `index.ts` today. There is also no route
 *     to it: reading a consent history needs a patient identifier, and no endpoint gives a
 *     patient their own (see app/book/page.tsx for the full trace through the backend).
 *   - `ConsentScreen` deliberately does NOT collect `delivery_disclosure`. It says so on
 *     screen instead, because H4 owns capturing it at the point delivery is chosen — which
 *     is this page, and which nothing has built.
 *
 * `granted: false` IS THEREFORE THE TRUTHFUL VALUE, not a placeholder: this portal has not
 * established that the consent stands, and the safe direction for "we do not know" is "we
 * have not been told yes". The API refuses a delivery without consent regardless, so
 * nothing is being protected here that is not already protected — this is the courteous
 * route to that rule, never the control.
 *
 * `href` IS A BOUNCE BACK TO THIS PAGE CARRYING A SENTENCE. Choosing delivery redirects
 * there instead of posting, and the patient reads what the permission is, why it is needed,
 * and that the clinic records it. That is better than the two alternatives: a link to
 * /consent would strand them on a screen that asks for a registration handoff they do not
 * have, and posting anyway would earn them a refusal they did nothing to deserve. The
 * sentence is route-layer copy — see messages/domains/Routes.en.json — because the honest
 * description of a gap in the routing tree is the routing tree's to write.
 *
 * WHEN THE GAP CLOSES both halves change in this file and nowhere else: `granted` becomes
 * the reader's answer and `href` becomes the capture page's path, at which point the
 * screen posts directly for a patient who has already agreed and nobody is asked twice.
 * ---------------------------------------------------------------------------------------
 *
 * A 404 COVERS "NO SUCH ORDER" AND "ANOTHER CLINIC'S ORDER" ALIKE, and this route must not
 * recover the difference. `outsideServiceArea` is not passed because there is no coverage
 * table, district list or tenant flag anywhere in the API to pass; it defaults to false,
 * and the screen already knows what to say the day there is one.
 */
export default async function FulfilmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ order: string }>
  searchParams: Promise<{ fulfilmentError?: string }>
}) {
  const [tenant, user, t, common, { order }, query] = await Promise.all([
    resolveTenant(),
    currentUser(),
    getTranslations('Routes'),
    getTranslations('Common'),
    params,
    searchParams,
  ])

  // The same two redirects as app/account/page.tsx. Both screens here sit behind a policy
  // that admits the patient of the record and nobody else.
  if (!user) {
    redirect('/sign-in')
  }

  if (user.password_change_required) {
    redirect('/set-password')
  }

  const result = await getDispenseOrder(order)

  if (!result.ok && result.notFound) {
    notFound()
  }

  const clinic = tenant.trading_name ?? common('thisClinic')
  const selfHref = `/orders/${encodeURIComponent(order)}/fulfilment`

  return (
    <SiteShell tenant={tenant} signedIn>
      <div className="site-wrap" style={{ paddingBlock: 'var(--space-8)' }}>
        <FulfilmentChoice
          result={result}
          clinic={clinic}
          selfHref={selfHref}
          deliveryConsent={{
            granted: false,
            href: `${selfHref}?fulfilmentError=${encodeURIComponent(
              t('fulfilment.consentNotHere', { clinic }),
            )}`,
          }}
          error={query.fulfilmentError}
        />
      </div>
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
