import Link from 'next/link'
import type { Tenant } from '@/lib/tenant'

/**
 * The clinic's footer.
 *
 * A SERVER COMPONENT, with nothing interactive in it. Four columns of links and the
 * clinic's own contact details cost nothing to render on the server and would cost a
 * hydration payload to render on the client, on the one surface with a hard first-paint
 * budget on a throttled 3G connection.
 *
 * WHOSE FOOTER THIS IS. The clinic's name, the clinic's address, the clinic's phone
 * number. The only Carevelo mark on the entire patient surface is the last line of the
 * bottom row, which the white-labeling document permits as "a discreet 'powered by
 * Carevelo'" and requires to be removable on higher tiers. Worth knowing while looking
 * at it: that line is the product's best acquisition channel — another clinic owner
 * seeing it is the referral dynamic the business plan depends on — but it comes second
 * to the clinic's confidence in its own brand, which is why it is small and last.
 *
 * THE LICENSING SENTENCE ABOVE IT IS NOT BOILERPLATE. Carevelo carries the software;
 * the clinic carries the care, the licence and the money. A patient who believed
 * otherwise would be wrong about who is treating them and wrong about who they paid,
 * and we have no access to the UMDPC or NDA registers to make any claim beyond it.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 */
export function SiteFooter({ tenant, signedIn }: { tenant: Tenant; signedIn: boolean }) {
  const name = tenant.trading_name
  const contact = tenant.contact

  return (
    <footer className="site-footer">
      <div className="site-wrap">
        <div className="site-footer__cols">
          <div>
            {/* The monogram rather than the uploaded logo: the logo is the header's
                job, and a second <img> here would need a second lint exemption for a
                mark the patient has already seen. */}
            <Link className="site-brand" href="/">
              <span className="site-brand__mark" aria-hidden="true">
                {name.slice(0, 1).toUpperCase()}
              </span>
              <span>{name}</span>
            </Link>
            <p>
              {name} online. Book a consultation, speak to a clinician, and have your
              medicine brought to you.
            </p>
          </div>

          <div>
            <h4>Get in touch</h4>
            <ul>
              {contact.phone ? (
                <li>
                  {/* A tap-to-call link, because most of these visits are on a phone.
                      The scheme is fixed here, so a clinic's stored value can only ever
                      be the number part of it. */}
                  <a className="tnum" href={`tel:${contact.phone.replace(/\s+/g, '')}`}>
                    {contact.phone}
                  </a>
                </li>
              ) : null}
              {contact.email ? (
                <li>
                  <a href={`mailto:${contact.email}`}>{contact.email}</a>
                </li>
              ) : null}
              {contact.physical_address ? <li>{contact.physical_address}</li> : null}
              {contact.district ? <li>{contact.district}, Uganda</li> : null}
            </ul>
          </div>

          <div>
            <h4>Your care</h4>
            <ul>
              <li>
                <Link href={signedIn ? '/account' : '/sign-in'}>
                  {signedIn ? 'My care' : 'Sign in'}
                </Link>
              </li>
              <li>
                <Link href="/#how">How it works</Link>
              </li>
              <li>
                <Link href="/#trust">Safety and privacy</Link>
              </li>
            </ul>
          </div>

          <div>
            <h4>Legal</h4>
            <ul>
              <li>
                <Link href="/privacy">Privacy</Link>
              </li>
              <li>
                <Link href="/terms">Terms</Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="site-footer__bottom">
          <span>
            Consultations, prescriptions and dispensing are provided by {name}, a licensed
            private clinic, and payment is made to {name}.
          </span>
          <span className="site-footer__by">Powered by Carevelo</span>
        </div>
      </div>
    </footer>
  )
}
