import { getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
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

      {/* SURVIVING INLINE STYLES, and the reason is the same one written out at length in
          src/app/account/page.tsx: `.card` lays its children out as a BLOCK, with no gap
          of its own, and the distances down this card are 0 (the eyebrow, the title and
          the lede sit flush by design), then 18, then 12, then 16, then 18. A single
          `<Stack>` around the card's contents would have to pick one of those and would
          silently open the three that are deliberately closed; a nest per pair is five
          wrapper elements to retire five properties. So the margins stay and each one is
          the distance it always was. */}
      <h2 style={{ marginTop: 'var(--space-6)' }}>{t('receipt.title')}</h2>

      {/* A `<dl>` and not a `<Stack>`: `Stack`'s `as` union has no `dl` on purpose — see
          its docblock — because a description list's dt/dd pairing is a semantic contract
          rather than a column, and this document's whole value is that a screen reader
          reads "Paid to: Kira Family Clinic" as one fact and not two. `.stack` gives the
          column; the 6px it sets is the distance between the pairs. */}
      <dl className="stack" style={{ marginTop: 'var(--space-4)' }}>
        {/* The payee, first and in full, because that is what this document asserts. */}
        <Fact label={t('receipt.paidTo')}>
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
        </Fact>

        {money === null ? null : (
          <Fact label={t('receipt.amount')}>
            <strong>
              <Money value={money} />
            </strong>
          </Fact>
        )}

        <Fact label={t('receipt.method')}>{method}</Fact>

        <Fact label={t('receipt.paidAt')}>
          {/* Africa/Kampala, always. The patient, the clinic and the money are all there. */}
          {paidAt === null ? t('receipt.notRecorded') : <DateTime value={paidAt} format="datetime" />}
        </Fact>

        {payableType === null ? null : (
          <Fact label={t('receipt.title')}>
            {payableType === 'appointment' ? t('receipt.forAppointment') : t('receipt.forOrder')}
          </Fact>
        )}

        {/* Both references in the monospace face, because both get read down a telephone
            and copied into an aggregator dashboard. `.mono` is the token layer's own class
            for exactly that; it was being written out as a style property here. */}
        <Fact label={t('receipt.reference')} valueClassName="mono">
          {receipt?.reference ?? intent.reference}
        </Fact>

        <Fact label={t('receipt.providerReference', { method })} valueClassName="mono">
          {providerReference ?? t('receipt.notRecorded')}
        </Fact>
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

/**
 * One labelled fact on the receipt: a `<dt>` and the `<dd>` it belongs to, in the `<div>`
 * wrapper that is the ONE element a `<dl>` is allowed to hold around a pair.
 *
 * WHY IT EXISTS AT ALL. Seven pairs were written out here, and every one of them carried
 * `style={{ margin: 0 }}` on its `<dd>` — not a layout decision but a user-agent one:
 * `dd` arrives with `margin-inline-start: 40px` from the browser's own stylesheet, and
 * reset.css normalises `h1`–`h4`, `p` and the layout utilities without touching the
 * description-list elements. Seven identical corrections, each free to be forgotten on
 * the eighth pair somebody adds. One correction, in one place, cannot be.
 *
 * THE ZERO IS DELIBERATELY NOT MOVED INTO reset.css, which would be the obvious tidy.
 * That file is shared by four apps, the console renders fourteen more `<dl>`s of its own,
 * and a `dd { margin: 0 }` there would silently re-lay-out every one of them. That is a
 * change the console's owner should make and see, not one to make on their behalf from
 * a sweep of the portal — it is reported instead.
 *
 * `<Stack>` cannot hold this either: it renders a div, and a `<dt>` outside a `<dl>` is
 * not a term, it is a stray element with a class on it.
 */
function Fact({
  label,
  valueClassName,
  children,
}: {
  label: string
  /** For the two references, which are read down a telephone and want the mono face. */
  valueClassName?: string | undefined
  children: ReactNode
}) {
  return (
    <div className="stack">
      <dt className="field__label">{label}</dt>
      {/* SURVIVING INLINE STYLE — the single UA reset the docblock above is about. */}
      <dd className={valueClassName} style={{ margin: 0 }}>
        {children}
      </dd>
    </div>
  )
}
