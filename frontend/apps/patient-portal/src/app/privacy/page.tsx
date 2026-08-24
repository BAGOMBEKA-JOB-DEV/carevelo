import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { clinicMetadata } from '@/lib/metadata'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { SiteShell } from '@/components/SiteShell'

/**
 * The clinic's privacy notice.
 *
 * IT EXISTS BECAUSE THE FOOTER LINKS TO IT. A footer with a dead "Privacy" link is worse
 * than a footer with none: it tells a patient there is a notice and then does not produce
 * one, which is the impression this page is here to prevent.
 *
 * WRITTEN FOR THE PATIENT, NOT FOR A REGULATOR. Plain sentences, short sections, and the
 * questions in the order somebody actually asks them: who has my information, who can see
 * it, how long is it kept, how do I get a copy.
 *
 * NOTHING LEGAL IS INVENTED. No statute is cited by name and year, no registration number
 * is quoted, and no data protection officer is named, because this file has no way to know
 * any of them and a confidently wrong citation in a clinic's own privacy notice is a real
 * liability rather than a typo. Where a clinic must supply something the text says so, in
 * the text, where a patient reads it — not in a comment where only we would.
 *
 * THE CONTROLLER/PROCESSOR SPLIT IS THE ONE PIECE OF JARGON KEPT, because it is the fact
 * that determines who a patient complains to, and it is explained in the sentence that
 * uses it.
 *
 * AND NOTHING LINGUISTIC IS INVENTED EITHER, WHICH IS THE SAME RULE APPLIED TWICE. This is
 * the page a patient must be able to read in their own language — the data protection note
 * requires plain language in English and Luganda, on screen rather than behind a link —
 * and it is also the page where a confident-sounding mistranslation does the most damage:
 * "we do not sell your data" rendered slightly wrong is a promise the clinic did not make.
 * So every sentence below lives in messages/en.json, the Luganda catalogue holds the
 * ENGLISH text for the ones no translator has reached yet, and messages/lg.needs-translation.json
 * is the exact worklist. A visibly English paragraph is an honest gap; a fluent wrong one
 * is a liability nobody would notice.
 *
 * @see docs/50-security-compliance/data-protection-dppa.md
 */
export default async function PrivacyPage() {
  const [tenant, user, t, common] = await Promise.all([
    resolveTenant(),
    currentUser(),
    getTranslations('Privacy'),
    getTranslations('Common'),
  ])
  const clinic = tenant.trading_name ?? common('thisClinic')
  const contact = tenant.contact

  /*
   * The street address and the district as ONE value. They were concatenated in the markup
   * before, which meant the comma between them was English punctuation baked into JSX; a
   * translator can now put the two parts in whatever order and with whatever separator the
   * language wants, because the sentence receives a finished address.
   */
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

        <p className="lead">{t('lead', { clinic })}</p>

        <h2>{t('responsibleHeading')}</h2>
        {/*
         * `t.rich` throughout this document rather than a bold fragment beside a plain
         * one. The emphasis is on a phrase INSIDE the sentence — "{clinic} is.", "data
         * controller" — and splitting the sentence at the boundary would hand a translator
         * half-sentences whose join order is fixed by our JSX rather than by their grammar.
         */}
        <p>{t.rich('controller', { clinic, b: (chunks) => <b>{chunks}</b> })}</p>
        <p>{t.rich('processor', { clinic, b: (chunks) => <b>{chunks}</b> })}</p>

        <h2>{t('heldHeading')}</h2>
        <ul>
          <li>{t.rich('heldIdentity', { clinic, b: (chunks) => <b>{chunks}</b> })}</li>
          <li>{t.rich('heldCare', { b: (chunks) => <b>{chunks}</b> })}</li>
          <li>{t.rich('heldPayments', { b: (chunks) => <b>{chunks}</b> })}</li>
          <li>{t.rich('heldUsage', { b: (chunks) => <b>{chunks}</b> })}</li>
        </ul>

        <h2>{t('seenHeading')}</h2>
        <ul>
          <li>{t.rich('seenYou', { b: (chunks) => <b>{chunks}</b> })}</li>
          <li>{t.rich('seenStaff', { clinic, b: (chunks) => <b>{chunks}</b> })}</li>
          <li>{t.rich('seenNobodyElse', { b: (chunks) => <b>{chunks}</b> })}</li>
          <li>{t.rich('seenCarevelo', { b: (chunks) => <b>{chunks}</b> })}</li>
          {/* The rider gets an address and the fact of a package. Never what is in it —
              that rule is enforced in the delivery payload itself, and stated here
              because a patient has no way to inspect a payload. */}
          <li>{t.rich('seenRider', { b: (chunks) => <b>{chunks}</b> })}</li>
        </ul>

        <h2>{t('paymentsHeading')}</h2>
        <p>{t('paymentsBody', { clinic })}</p>

        <h2>{t('retentionHeading')}</h2>
        <p>{t.rich('retentionRecords', { clinic, b: (chunks) => <b>{chunks}</b> })}</p>
        <p>{t('retentionPayments')}</p>

        <h2>{t('accessHeading')}</h2>
        <p>{t('accessBody', { clinic })}</p>
        <p>{t('accessNote')}</p>

        <h2>{t('cookiesHeading')}</h2>
        {/* Updated in the same change that made this sentence true: the language choice is
            a second cookie now, and a privacy notice that failed to mention a cookie the
            product had just started setting would be the exact kind of quiet inaccuracy
            this page exists to avoid. */}
        <p>{t('cookiesBody')}</p>

        <h2>{t('wrongHeading')}</h2>
        <p>{t.rich('wrongBody', { clinic, b: (chunks) => <b>{chunks}</b> })}</p>
        <p>{t('wrongBreach', { clinic })}</p>

        <h2>{t('contactHeading')}</h2>
        <p>
          {contact?.phone ? (
            <>
              {t.rich('contactPhone', {
                clinic,
                phone: contact.phone,
                tnum: (chunks) => <b className="tnum">{chunks}</b>,
              })}{' '}
            </>
          ) : null}
          {contact?.email ? <>{t('contactEmail', { email: contact.email })} </> : null}
          {address ? <>{t('contactAddress', { address })}</> : null}
          {hasContactDetails ? null : t('contactNone', { clinic })}
        </p>

        <p>
          <Link className="site-textlink" href="/terms">
            {t('readTerms')}
          </Link>
        </p>
      </div>
    </SiteShell>
  )
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
