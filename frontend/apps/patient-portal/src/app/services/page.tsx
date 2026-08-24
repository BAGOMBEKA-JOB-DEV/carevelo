import { redirect } from 'next/navigation'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { ServiceCatalogue } from '@/domains/scheduling'
import { SiteShell } from '@/components/SiteShell'
import { SCHEDULING_PATHS } from '../paths'

/**
 * What the clinic offers, and what it charges.
 *
 * BEHIND A SESSION, even though a price list is not clinical. `ServiceController` filters
 * an unauthenticated caller's view anyway, but the stronger reason is commercial: which
 * services a named clinic offers, and at what price, is that clinic's own information, and
 * this portal is not a public web page — `clinicMetadata` marks every page noindex for the
 * same reason. So the guard is the one /account already uses.
 *
 * THE SCREEN FETCHES FOR ITSELF and degrades to a notice rather than throwing, which is
 * why there is no read here and no loading state: a catalogue that cannot be reached is a
 * sentence on the page, not an error boundary. See domains/scheduling/index.ts.
 */
export default async function ServicesPage() {
  const [tenant, user] = await Promise.all([resolveTenant(), currentUser()])

  // The same two redirects as app/account/page.tsx, and for the same reasons: a cookie
  // cannot know it has been invalidated, and the API refuses every other authenticated
  // request while `password_change_required` stands.
  if (!user) {
    redirect('/sign-in')
  }

  if (user.password_change_required) {
    redirect('/set-password')
  }

  return (
    <SiteShell tenant={tenant} signedIn>
      <ServiceCatalogue tenant={tenant} paths={SCHEDULING_PATHS} />
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
