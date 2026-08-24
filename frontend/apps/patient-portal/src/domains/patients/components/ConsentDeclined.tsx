import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Button, Card, Notice } from '@carevelo/ui'
import type { Tenant } from '@/lib/tenant'
import { PageBody } from '@/components/PageBody'

/**
 * What a patient sees after declining.
 *
 * THE ONE THING THIS SCREEN MUST DO IS NOT PUNISH THEM. Declining consent is a lawful
 * choice, it is the choice the statute assumes when nobody has affirmed anything, and a
 * page that treats it as an error teaches the next patient to tick without reading. So
 * there is no red, no "you cannot continue", and no repeat of the question.
 *
 * IT SAYS WHAT ACTUALLY HAPPENED, in the words the PRD uses: the registration ended, only
 * the minimal contact detail needed to explain why service cannot proceed is kept and it is
 * purged on schedule, no clinical footprint exists — and THE PATIENT MAY STILL ATTEND IN
 * PERSON AND CONSENT LATER. That last sentence is required, and it is required because it
 * is true: care is not conditional on using this portal.
 *
 * @see docs/10-product/prd-h2-patient-registration-consent.md — exception paths
 */
export async function ConsentDeclined({
  tenant,
  /** Where "start again" goes. The registration screen, normally. */
  registerHref,
}: {
  tenant: Tenant
  registerHref: string
}): Promise<ReactElement> {
  const [t, common] = await Promise.all([
    getTranslations('Patients'),
    getTranslations('Common'),
  ])

  const clinic = tenant.trading_name ?? common('thisClinic')
  const phone = tenant.contact?.phone

  return (
    <PageBody>
      <div className="grid" style={{ gap: 'var(--space-7)' }}>
        <div className="site-sec-head">
          <span className="site-eyebrow">{t('declined.eyebrow')}</span>
          <h1 className="site-h1">{t('declined.title')}</h1>
          <p className="site-lede">{t('declined.lede', { clinic })}</p>
        </div>

        <Card as="section" aria-labelledby="declined-what-happens">
          <h2 className="title" id="declined-what-happens">
            {t('declined.whatHappensHeading')}
          </h2>

          <p className="subtitle" style={{ marginTop: 'var(--space-4)' }}>
            {t('declined.nothingClinical')}
          </p>
          <p className="subtitle" style={{ marginTop: 'var(--space-4)' }}>
            {t('declined.contactPurged')}
          </p>
        </Card>

        {/* The sentence the exception path exists to deliver. Not a footnote. */}
        <Notice tone="info" icon="heart" title={t('declined.stillWelcomeTitle', { clinic })}>
          {phone ? t('declined.stillWelcomeWithPhone', { clinic, phone }) : t('declined.stillWelcome', { clinic })}
        </Notice>

        <div className="site-btn-row">
          <Button variant="brand" href={registerHref}>
            {t('declined.startAgain')}
          </Button>
          <Button variant="quiet" href="/">
            {t('declined.backToClinic', { clinic })}
          </Button>
        </div>
      </div>
    </PageBody>
  )
}
