import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { Tenant } from '@/lib/tenant'

/**
 * The clinic's footer.
 *
 * A SERVER COMPONENT. Four columns of links and the clinic's own contact details cost
 * nothing to render on the server and would cost a hydration payload to render on the
 * client, on the one surface with a hard first-paint budget on a throttled 3G connection.
 * There is no interactivity left in this footer at all, so it ships no JavaScript.
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
 * IT USED TO HOLD THE LANGUAGE CONTROL, in the first column under the clinic's blurb, and
 * that is worth a line here rather than only in the git log: whoever comes looking for the
 * switcher a screenshot or a stale note mentions should find out here that it was removed
 * rather than moved. The portal offered English and Luganda, the Luganda catalogue never
 * got past 7% real prose, and a button that swapped English sentences for English sentences
 * labelled "Oluganda" was a false claim rather than a partial feature — see i18n/locales.ts
 * for the full argument and for why the message layer around it was kept. With one language
 * there is nothing to choose, so the control, its server action and its cookie all went.
 *
 * @see docs/10-product/white-labeling-and-branding.md
 */
export async function SiteFooter({ tenant, signedIn }: { tenant: Tenant; signedIn: boolean }) {
  const t = await getTranslations('Footer')
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
            <p>{t('blurb', { clinic: name })}</p>
          </div>

          <div>
            {/* An `<h2>`, not the `<h4>` this was. These four column labels are the only
                headings between the page's own `<h2>` sections and the end of the document, so
                at h4 every page in the app announced a jump from h1 or h2 straight to h4 —
                and a screen-reader user navigating by heading hears that as two levels of
                structure that are missing rather than as a footer. They are top-level regions
                of the page, so they are level 2. Nothing about how they LOOK changes:
                `.site-footer h2` in tokens/site.css carries the same 12.5px uppercase it
                always did, because the token layer sizes headings by class and context and
                never by depth — see typography.css. */}
              <h2>{t('getInTouch')}</h2>
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
              {contact.district ? (
                <li>{t('districtLine', { district: contact.district })}</li>
              ) : null}
            </ul>
          </div>

          <div>
            <h2>{t('yourCare')}</h2>
            <ul>
              <li>
                <Link href={signedIn ? '/account' : '/sign-in'}>
                  {signedIn ? t('myCare') : t('signIn')}
                </Link>
              </li>
              <li>
                <Link href="/#how">{t('howItWorks')}</Link>
              </li>
              <li>
                <Link href="/#trust">{t('safetyAndPrivacy')}</Link>
              </li>
            </ul>
          </div>

          <div>
            <h2>{t('legal')}</h2>
            <ul>
              <li>
                <Link href="/privacy">{t('privacy')}</Link>
              </li>
              <li>
                <Link href="/terms">{t('terms')}</Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="site-footer__bottom">
          <span>{t('licensing', { clinic: name })}</span>
          <span className="site-footer__by">{t('poweredBy')}</span>
        </div>
      </div>
    </footer>
  )
}
