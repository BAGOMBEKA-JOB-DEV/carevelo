import type { ReactNode } from 'react'
import type { Tenant } from '@/lib/tenant'

/**
 * The patient portal's frame.
 *
 * THE CLINIC'S BRAND, AND NOTHING OF CAREVELO'S. The header carries the clinic's
 * logo, name and colours; the patient's relationship is with the clinic, and this
 * header is the whole of that impression.
 *
 * The only Carevelo mark on the surface is the footer line, which the white-labeling
 * document permits as "a discreet 'powered by Carevelo'" and requires to be removable
 * on higher tiers. Worth knowing while looking at it: that footer is the product's
 * best acquisition channel — another clinic owner seeing it is the referral dynamic
 * the business plan depends on — but it comes second to the clinic's confidence in
 * its own brand, which is why it is one small line at the bottom.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 */
export function SiteShell({ tenant, children }: { tenant: Tenant; children: ReactNode }) {
  const branding = tenant.branding
  const name = tenant.trading_name ?? 'Clinic'

  return (
    <div className="site">
      {/* First focusable element. A patient using a screen reader or keyboard should
          not have to pass the header to reach the booking form. */}
      <a className="skip-link" href="#main">
        Skip to content
      </a>

      <header className="site__header">
        {branding?.logo_url ? (
          // Alt text names the clinic rather than saying "logo": a screen reader
          // announcing "logo" tells the patient nothing about whose clinic this is.
          /*
           * A plain <img>, deliberately. next/image would route a TENANT-UPLOADED
           * asset through Next's optimiser: more client JS on a surface with a 150KB
           * budget, and a second cache layer over an image the backend already
           * validated for format and dimensions, stripped of metadata, re-encoded and
           * served from tenant-partitioned storage. Nothing is left for the optimiser
           * to do except add weight. Height is capped in CSS so a tall logo cannot
           * push the header open.
           */
          // eslint-disable-next-line @next/next/no-img-element
          <img className="site__logo" src={branding.logo_url} alt={name} />
        ) : null}
        <span className="site__name">{name}</span>
      </header>

      <main className="site__main" id="main">
        {children}
      </main>

      <footer className="site__footer">
        <p>{name}</p>
        {tenant.contact?.phone ? <p>{tenant.contact.phone}</p> : null}
        <p className="fine">Powered by Carevelo</p>
      </footer>
    </div>
  )
}
