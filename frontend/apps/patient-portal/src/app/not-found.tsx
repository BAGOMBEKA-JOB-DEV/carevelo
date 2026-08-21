/**
 * Shown for a host that does not resolve to a clinic.
 *
 * NEUTRAL ON PURPOSE. It must never confirm or deny whether a given clinic uses
 * Carevelo: that is the clinic's commercial information, and enumerating the customer
 * list should not be a `for` loop over subdomains. So it says nothing about clinics,
 * carries no branding — there is no tenant to brand it with — and reads the same for
 * a host that never existed and one offboarded last week.
 *
 * That is also why it is the one page on the surface with no SiteShell: the frame carries
 * the clinic's header, footer and name, and there is no clinic here to carry. The layout's
 * tokens still apply, so it renders in the default palette and the product's own type.
 *
 * Rendered INSIDE the root layout, which is why it no longer carries an <html> of its own.
 * It used to, because the layout called notFound() itself and so could never wrap this
 * page — Next answered with a global error shell containing no readable text at all. With
 * the layout lenient (see lib/tenant.ts) a stale or mistyped PATH on a real clinic's host
 * now renders this text server-side, and reads with JavaScript switched off. That is the
 * 404 a patient can actually arrive at.
 *
 * ONE CASE STILL DEFERS ITS BODY TO THE CLIENT, knowingly: an unknown clinic HOST. There
 * the page itself throws notFound() during render, and in a production build Next answers
 * a render-time notFound() with a minimal shell so it can still send a 404 status —
 * `loading.md` is explicit that a 404 status requires the resource to be checked "before
 * the response body is streamed", and points at `proxy` as the only place to do that. A
 * proxy check means an extra tenant lookup on EVERY request, including every real
 * patient's, to improve a page reached only by typos and subdomain scanners. On a product
 * whose binding constraint is a slow mobile network that is the wrong way round, so the
 * status is kept, the body is left to the client, and nothing leaks either way.
 *
 * @see docs/10-product/white-labeling-and-branding.md acceptance criterion 8
 */
export default function NotFound() {
  return (
    <main className="site-pagehero">
      <h1 className="site-h1">Page not found</h1>
      <p className="site-lede">Check the address and try again.</p>
    </main>
  )
}
