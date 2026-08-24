import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { SiteShell } from '@/components/SiteShell'

/**
 * The terms a patient is actually agreeing to by using the portal.
 *
 * IT EXISTS BECAUSE THE FOOTER LINKS TO IT, and because the single most important thing
 * on it — that this is not for an emergency — is worth a page of its own rather than a
 * line of small print somebody scrolls past.
 *
 * THE DIVISION OF RESPONSIBILITY IS THE WHOLE DOCUMENT. The clinic provides the care and
 * carries the licence; Carevelo provides the software and never touches either. Every
 * section below is a consequence of that one sentence, including the uncomfortable ones:
 * we cannot refund a consultation, because the money never came to us.
 *
 * NOTHING LEGAL IS INVENTED. No statute, no registration number, no governing-law clause
 * pulled out of the air — where a clinic must state something the text says so plainly,
 * in the text, where a patient reads it.
 *
 * THE EMERGENCY NOTICE IS THE FIRST STRING A TRANSLATOR SHOULD BE GIVEN, on the day this
 * portal gains a second language. Everything else on this page is a matter of money or
 * expectations; that one is the sentence that tells somebody holding a phone next to a
 * person who cannot breathe to stop reading and go. Until a human has cleared it, it should
 * stay visibly English — a reader can recognise a foreign paragraph and ask about it, which
 * they cannot do with a fluent guess at the word for "unconscious". That is the same
 * judgement that removed the 7%-complete Luganda catalogue rather than shipping it; see
 * i18n/locales.ts.
 */
export default async function TermsPage() {
  const [tenant, user, t, common] = await Promise.all([
    resolveTenant(),
    currentUser(),
    getTranslations('Terms'),
    getTranslations('Common'),
  ])
  const clinic = tenant.trading_name ?? common('thisClinic')
  const contact = tenant.contact

  // One finished address rather than a street and a district joined by a comma in the
  // markup: the comma is English punctuation, and a translator cannot move it out of JSX.
  const address = contact?.physical_address
    ? contact.district
      ? `${contact.physical_address}, ${contact.district}`
      : contact.physical_address
    : null

  const hasContactDetails = Boolean(contact?.phone ?? contact?.email ?? address)

  return (
    <SiteShell tenant={tenant} signedIn={Boolean(user)}>
      <div className="site-pagehero">
        <span className="site-eyebrow">{t('eyebrow')}</span>
        <h1 className="site-h1">{t('title', { clinic })}</h1>
        <p className="site-lede">{t('lede')}</p>
      </div>

      <div className="site-doc">
        <p className="updated">{t('updated', { clinic })}</p>

        {/*
         * TWO WHOLE SENTENCES, NOT ONE WITH A TAIL GLUED ON. The version with a phone
         * number and the version without are separate messages, because "or call {clinic}
         * on {phone}" handed to a translator on its own is a fragment with no visible
         * subject — and this is the one paragraph on the site where an awkward join could
         * cost somebody the seconds it takes to understand it.
         */}
        <div className="notice notice-bad">
          {contact?.phone
            ? t.rich('emergencyWithPhone', {
                clinic,
                phone: contact.phone,
                b: (chunks) => <b>{chunks}</b>,
              })
            : t.rich('emergency', { b: (chunks) => <b>{chunks}</b> })}
        </div>

        <p className="lead">{t('lead', { clinic })}</p>

        <h2>{t('whoHeading')}</h2>
        <p>{t.rich('whoClinic', { clinic, b: (chunks) => <b>{chunks}</b> })}</p>
        <p>{t.rich('whoCarevelo', { clinic, b: (chunks) => <b>{chunks}</b> })}</p>

        <h2>{t('accountHeading')}</h2>
        <p>{t('accountPassword', { clinic })}</p>
        <p>{t('accountSharedPhone', { clinic })}</p>
        <p>{t('accountOnBehalf')}</p>

        <h2>{t('bookingHeading')}</h2>
        <p>{t.rich('bookingBody', { clinic, b: (chunks) => <b>{chunks}</b> })}</p>

        <h2>{t('payingHeading')}</h2>
        <p>{t('payingBody', { clinic })}</p>
        {/*
         * The uncomfortable consequence, stated rather than buried. Carevelo is never in
         * the payment path — the money moves from the patient to the clinic's own mobile
         * money account — so we could not refund a consultation even if we wanted to, and
         * a patient who asks us is a patient whose refund is delayed.
         */}
        <p>{t.rich('payingRefunds', { clinic, b: (chunks) => <b>{chunks}</b> })}</p>

        <h2>{t('prescriptionsHeading')}</h2>
        <p>{t('prescriptionsBody', { clinic })}</p>
        <p>{t('prescriptionsControlled', { clinic })}</p>

        <h2>{t('unavailableHeading')}</h2>
        <p>{t('unavailableBody', { clinic })}</p>

        <h2>{t('recordsHeading')}</h2>
        {/* The link to the privacy notice sits INSIDE the sentence, so it travels as a
            rich tag. A translator moves the linked words wherever the grammar puts them
            and the href stays here, where it can be checked. */}
        <p>
          {t.rich('recordsBody', {
            clinic,
            privacy: (chunks) => <Link href="/privacy">{chunks}</Link>,
          })}
        </p>

        <h2>{t('endingHeading')}</h2>
        <p>{t('endingBody', { clinic })}</p>
        <p>{t('endingSuspension', { clinic })}</p>

        <h2>{t('changesHeading')}</h2>
        <p>{t('changesBody', { clinic })}</p>

        <h2>{t('lawHeading')}</h2>
        <p>{t.rich('lawBody', { clinic, b: (chunks) => <b>{chunks}</b> })}</p>

        <h2>{t('contactHeading')}</h2>
        <p>
          {t('contactIntro', { clinic })}
          {contact?.phone ? (
            <>
              {' '}
              {t.rich('contactPhone', {
                phone: contact.phone,
                tnum: (chunks) => <b className="tnum">{chunks}</b>,
              })}
            </>
          ) : null}
          {contact?.email ? <> {t('contactEmail', { email: contact.email })}</> : null}
          {address ? <> {t('contactAddress', { address })}</> : null}
          {hasContactDetails ? null : <> {t('contactNone', { clinic })}</>}
        </p>

        <p>
          <Link className="site-textlink" href="/privacy">
            {t('readPrivacy')}
          </Link>
        </p>
      </div>
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
