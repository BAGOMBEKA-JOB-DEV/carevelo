import type { ReactNode } from 'react'
import type { Tenant } from '@/lib/tenant'
import { SiteFooter } from './SiteFooter'
import { SiteHeader } from './SiteHeader'

/**
 * The patient-facing frame: a scroll-aware clinic header, the page, and the clinic's
 * footer.
 *
 * A SERVER COMPONENT. Only the header is a client component, and only because the
 * frosted-on-scroll state and the mobile drawer need an event listener; the frame
 * itself, the skip link and the whole footer are rendered once on the server and ship
 * no JavaScript.
 *
 * THE CLINIC'S BRAND, AND NOTHING OF CAREVELO'S. The header carries the clinic's logo,
 * name and colours; the patient's relationship is with the clinic, and this frame is the
 * whole of that impression. The one Carevelo mark is the last line of the footer, which
 * the white-labeling document permits as a discreet attribution.
 *
 * Applied by the PAGES that want it rather than by the root layout, because sign-in is a
 * full-bleed split screen with no room for site chrome.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 */
export function SiteShell({
  tenant,
  signedIn,
  children,
}: {
  tenant: Tenant
  signedIn: boolean
  children: ReactNode
}) {
  return (
    <div className="site-root">
      {/* First focusable element. A patient using a keyboard or a screen reader should
          not have to pass the header to reach the page. */}
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <SiteHeader tenant={tenant} signedIn={signedIn} />

      <main id="main">{children}</main>

      <SiteFooter tenant={tenant} signedIn={signedIn} />
    </div>
  )
}
