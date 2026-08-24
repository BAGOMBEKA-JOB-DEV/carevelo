import { getTranslations } from 'next-intl/server'
import { Notice } from '@carevelo/ui'
import type { Tenant } from '@/lib/tenant'
import { clinicName } from './screen'

/**
 * What to do about money back — said plainly, because the alternative is looking broken.
 *
 * ------------------------------------------------------------------
 * THERE IS NO REFUND BUTTON, AND ITS ABSENCE IS THE PRODUCT.
 *
 * The patient paid the CLINIC's own merchant account at a licensed aggregator, using the
 * clinic's own credentials, and the money went to the clinic direct. Carevelo was never in
 * that path and holds nothing to give back. A refund is therefore something the clinic
 * executes through its own aggregator; what this platform can honestly offer is to record
 * that the request was made and what was decided.
 *
 * The backend says the same thing in the only place it can: `PaymentIntentPolicy::refund()`
 * returns `false` with the comment "there is no refund permission, because there is no
 * refund capability". There is no endpoint for this component to call, and adding one would
 * be a claim of custody — which is what the whole non-custodial architecture exists to
 * avoid, and would land this platform in the NPS Act 2020 PSP category with its
 * UGX 250m–10bn capital requirements.
 *
 * "The UI must say so plainly rather than appear broken" is the PRD's own instruction for
 * this case, and a screen that simply omits any mention of refunds appears broken in
 * exactly the way it warns about: the patient hunts for the button, does not find it, and
 * concludes the software is unfinished rather than that they should telephone the clinic.
 *
 * @see docs/10-product/prd-h5-payments-non-custodial.md — "Refund requested"
 * @see docs/50-security-compliance/payments-regulatory-boundary.md
 */
export async function RefundGuidance({ tenant }: { tenant: Tenant }) {
  const [t, common] = await Promise.all([getTranslations('Payments'), getTranslations('Common')])

  const clinic = clinicName(tenant, common('thisClinic'))
  const phone = tenant.contact.phone

  return (
    <Notice tone="neutral" icon="help" title={t('refunds.title')}>
      <div className="stack">
        <span>{t('refunds.body', { clinic })}</span>
        <span>{t('refunds.how', { clinic })}</span>
        {phone === null ? null : (
          <span>
            <a className="lnk" href={`tel:${phone}`}>
              {t('actions.callClinic', { clinic, phone })}
            </a>
          </span>
        )}
      </div>
    </Notice>
  )
}
