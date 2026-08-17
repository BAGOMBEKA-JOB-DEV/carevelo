import '@carevelo/ui/tokens.css'

/**
 * Shown for a host that does not resolve to a clinic.
 *
 * NEUTRAL ON PURPOSE. It must never confirm or deny whether a given clinic uses
 * Carevelo: that is the clinic's commercial information, and enumerating the customer
 * list should not be a `for` loop over subdomains. So it says nothing about clinics,
 * carries no branding — there is no tenant to brand it with — and reads the same for
 * a host that never existed and one offboarded last week.
 *
 * Its own <html> because the root layout resolves a tenant, and there isn't one.
 *
 * @see docs/10-product/white-labeling-and-branding.md acceptance criterion 8
 */
export default function NotFound() {
  return (
    <html lang="en">
      <body>
        <main className="site__main">
          <div className="empty">
            <p className="empty__title">Page not found</p>
            <p>Check the address and try again.</p>
          </div>
        </main>
      </body>
    </html>
  )
}
