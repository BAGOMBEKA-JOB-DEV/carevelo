import type { ReactNode } from 'react'
import { brandStyle } from '@carevelo/ui'
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
    /*
     * THE CLINIC'S TOKENS, in the first HTML byte. They used to sit on <html>, which forced
     * the root layout to fetch the tenant — and a fetch in the root layout makes the render
     * Next performs for a Server Action redirect allocate ~800MB and never finish. Custom
     * properties inherit, so setting them here reaches every descendant exactly as before.
     *
     * A style OBJECT, so React sets these through the CSSOM. No tenant value is ever
     * concatenated into markup, which is a stronger guarantee than validation alone.
     */
    <div className="site-root" style={brandStyle(tenant.branding)}>
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
