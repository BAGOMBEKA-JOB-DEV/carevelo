import { getTranslations } from 'next-intl/server'
import { Card, DateTime, Icon, Money, Notice } from '@carevelo/ui'
import type { Tenant } from '@/lib/tenant'
import { moneyFrom, type PaymentIntent, type Receipt } from '../api/types'
import { RefundGuidance } from './RefundGuidance'
import { clinicName, methodKeyOf } from './screen'

/**
 * The receipt. `succeeded`, and the money is the clinic's.
 *
 * ------------------------------------------------------------------
 * THE PAYEE IS THE CLINIC. CAREVELO APPEARS ON THIS DOCUMENT IN NO ROLE AT ALL.
 *
 * Every value in the payee block comes from `ReceiptResource`, which resolves it from the
 * tenant server-side. Nothing here adds a platform name, a platform logo or a "powered by"
 * line, and nothing may: the clinic received the money, a receipt naming us would be a false
 * statement on a financial document, and worse, a claim of custody.
 *
 * TWO REFERENCES, BOTH SHOWN. Ours (`PAY-2608-0455`) is what the clinic matches on its own
 * aggregator dashboard, because it was sent as `merchant_reference`. The aggregator's is the
 * line the aggregator itself will quote back. A patient with a question has both halves in
 * hand before they dial, which is the difference between a two-minute call and a
 * twenty-minute one.
 *
 * DEGRADES RATHER THAN DISAPPEARS. If the receipt call failed, this still says "paid" from
 * the intent — which is the record — and says the document could not be loaded. Losing the
 * whole screen because a second request failed would be a worse answer to "did my money
 * arrive" than a partial one.
 */
export async function PaymentReceiptCard({
  tenant,
  intent,
  receipt,
}: {
  tenant: Tenant
  intent: PaymentIntent
  /** Null when the receipt call failed. The intent alone is enough to render the facts. */
  receipt: Receipt | null
}) {
  const [t, common] = await Promise.all([getTranslations('Payments'), getTranslations('Common')])

  const clinic = clinicName(tenant, common('thisClinic'))
  const method = t(`methods.${methodKeyOf(receipt?.method ?? intent.method)}.label`)
  const money = moneyFrom(receipt?.amount ?? intent.amount)
  const paidAt = receipt?.paid_at ?? intent.resolved_at
  const providerReference = receipt?.aggregator_reference ?? intent.aggregator_reference

  /*
   * `payable.type` is typed `unknown` in the generated contract — the backend reads it off
   * the model with getAttribute(), which the generator cannot see through. So it is narrowed
   * here rather than trusted, and an unrecognised value simply omits the line. A receipt is
   * still a receipt without a description of what was bought; it is not one with the word
   * "undefined" on it.
   */
  const payableType = typeof receipt?.payable.type === 'string' ? receipt.payable.type : null

  return (
    <Card as="section">
      <span className="site-eyebrow">{t('status.succeeded')}</span>

      <h1 className="row">
        <Icon name="check" size={28} />
        <span className="grow">{t('paid.title')}</span>
      </h1>

      <p>{t('paid.subtitle', { clinic })}</p>

      {receipt === null ? (
        <Notice tone="warn">{t('receipt.unavailable')}</Notice>
      ) : null}

      <h2 style={{ marginTop: 'var(--space-6)' }}>{t('receipt.title')}</h2>

      <dl className="stack" style={{ marginTop: 'var(--space-4)' }}>
        {/* The payee, first and in full, because that is what this document asserts. */}
        <div className="stack">
          <dt className="field__label">{t('receipt.paidTo')}</dt>
          <dd style={{ margin: 0 }}>
            <strong>{receipt?.payee.name ?? clinic}</strong>
            {receipt === null ? null : (
              <>
                {receipt.payee.legal_name === receipt.payee.name ? null : (
                  <div className="muted">{receipt.payee.legal_name}</div>
                )}
                {receipt.payee.physical_address === null ? null : (
                  <div className="muted">{receipt.payee.physical_address}</div>
                )}
                {receipt.payee.district === null ? null : (
                  <div className="muted">{receipt.payee.district}</div>
                )}
                {receipt.payee.contact_phone === null ? null : (
                  <div className="muted">{receipt.payee.contact_phone}</div>
                )}
              </>
            )}
          </dd>
        </div>

        {money === null ? null : (
          <div className="stack">
            <dt className="field__label">{t('receipt.amount')}</dt>
            <dd style={{ margin: 0 }}>
              <strong>
                <Money value={money} />
              </strong>
            </dd>
          </div>
        )}

        <div className="stack">
          <dt className="field__label">{t('receipt.method')}</dt>
          <dd style={{ margin: 0 }}>{method}</dd>
        </div>

        <div className="stack">
          <dt className="field__label">{t('receipt.paidAt')}</dt>
          <dd style={{ margin: 0 }}>
            {/* Africa/Kampala, always. The patient, the clinic and the money are all there. */}
            {paidAt === null ? t('receipt.notRecorded') : <DateTime value={paidAt} format="datetime" />}
          </dd>
        </div>

        {payableType === null ? null : (
          <div className="stack">
            <dt className="field__label">{t('receipt.title')}</dt>
            <dd style={{ margin: 0 }}>
              {payableType === 'appointment' ? t('receipt.forAppointment') : t('receipt.forOrder')}
            </dd>
          </div>
        )}

        <div className="stack">
          <dt className="field__label">{t('receipt.reference')}</dt>
          <dd style={{ margin: 0, fontFamily: 'var(--mono)' }}>{receipt?.reference ?? intent.reference}</dd>
        </div>

        <div className="stack">
          <dt className="field__label">{t('receipt.providerReference', { method })}</dt>
          <dd style={{ margin: 0, fontFamily: 'var(--mono)' }}>
            {providerReference ?? t('receipt.notRecorded')}
          </dd>
        </div>
      </dl>

      {/*
       * The API's own sentence, verbatim: "This payment was made to and received by <clinic>.
       * Take any question about it, including any refund, to the clinic." It is written by
       * the resource that knows who the payee is, and re-writing it here would be a second
       * copy of a legal statement free to drift from the first.
       */}
      {receipt === null ? null : (
        <p className="muted" style={{ marginTop: 'var(--space-5)' }}>
          {receipt.note}
        </p>
      )}

      <div style={{ marginTop: 'var(--space-6)' }}>
        <RefundGuidance tenant={tenant} />
      </div>
    </Card>
  )
}
