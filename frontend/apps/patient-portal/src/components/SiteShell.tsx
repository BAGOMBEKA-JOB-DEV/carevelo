import type { ReactNode } from 'react'
import Link from 'next/link'
import type { Tenant } from '@/lib/tenant'
import { SiteHeader } from './SiteHeader'

/**
 * The patient-facing frame: a scroll-aware clinic header, the page, and the footer.
 *
 * THE CLINIC'S BRAND, AND NOTHING OF CAREVELO'S. The header carries the clinic's logo,
 * name and colours; the patient's relationship is with the clinic, and this frame is the
 * whole of that impression.
 *
 * The only Carevelo mark on the surface is one line at the bottom of the footer, which
 * the white-labeling document permits as "a discreet 'powered by Carevelo'" and requires
 * to be removable on higher tiers. Worth knowing while looking at it: that line is the
 * product's best acquisition channel — another clinic owner seeing it is the referral
 * dynamic the business plan depends on — but it comes second to the clinic's confidence
 * in its own brand, which is why it is small and last.
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
  const name = tenant.trading_name ?? 'Clinic'
  const contact = tenant.contact

  return (
    <div className="site-root">
      {/* First focusable element. A patient using a keyboard or a screen reader should
          not have to pass the header to reach the page. */}
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <SiteHeader tenant={tenant} signedIn={signedIn} />

      <main id="main">{children}</main>

      <footer className="site-footer">
        <div className="site-wrap">
          <div className="site-footer__grid">
            <div className="site-footer__col">
              <span className="site-footer__title">{name}</span>
              {contact?.physical_address ? <span>{contact.physical_address}</span> : null}
              {contact?.district ? <span>{contact.district}, Uganda</span> : null}
            </div>

            <div className="site-footer__col">
              <span className="site-footer__title">Get in touch</span>
              {contact?.phone ? <span className="tnum">{contact.phone}</span> : null}
              {contact?.email ? <span>{contact.email}</span> : null}
            </div>

            <div className="site-footer__col">
              <span className="site-footer__title">Your care</span>
              <Link className="lnk" href="/sign-in">
                Sign in
              </Link>
              <a className="lnk" href="#how">
                How it works
              </a>
              <a className="lnk" href="#trust">
                Safety and privacy
              </a>
            </div>
          </div>

          <p className="site-footer__note">
            {/*
             * The attribution, and the disclaimer that has to sit beside it. Carevelo
             * carries the software; the clinic carries the care and the licence. Saying
             * otherwise — or saying nothing — would imply we had checked a register we
             * have no access to.
             */}
            Consultations, prescriptions and dispensing are provided by {name}, a licensed
            private clinic, and payment is made to {name}. Powered by Carevelo.
          </p>
        </div>
      </footer>
    </div>
  )
}
