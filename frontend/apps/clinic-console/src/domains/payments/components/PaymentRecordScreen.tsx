import type { ReactNode } from 'react'
import { Card, DateTime, Money, Notice, PageHeader } from '@carevelo/ui'
import type { PaymentIntent, Receipt } from '../api/types'
import { isCash, isSucceeded, isUnresolved, methodLabel, moneyFrom, statusOf } from '../api/types'
import { CashAttestation } from './CashAttestation'
import { NonCustodialNotice } from './NonCustodialNotice'
import { PaymentStatusBadge } from './PaymentStatusBadge'
import { RefundGuidance } from './RefundGuidance'

/**
 * One payment attempt, everything the clinic can know about it, and the one control staff
 * may exercise over it.
 *
 * ------------------------------------------------------------------
 * WHAT DECIDES WHETHER THE ATTESTATION CONTROL APPEARS
 *
 * Exactly two facts, and they are checked here rather than left to the API to refuse:
 * the method is cash, and the attempt is unresolved. Showing the control for a
 * mobile-money attempt and letting the 409 explain it would be teaching the front desk that
 * the button sometimes works on mobile money, which is precisely the belief that ends with
 * somebody insisting it should. An aggregator-backed collection is resolved by the
 * aggregator that took it or by reconciliation, never by hand, and the screen says so in
 * the place where the button is not.
 *
 * `timed_out` COUNTS AS UNRESOLVED and therefore still offers the control, because a
 * timeout is not an ending — a patient whose mobile-money prompt went unanswered very often
 * pays in cash at the counter instead, and that is the ordinary case rather than an edge
 * one.
 *
 * ------------------------------------------------------------------
 * THE FAILURE MESSAGE IS SHOWN VERBATIM
 *
 * Only the aggregator knows why a collection failed, and paraphrasing loses the part
 * somebody can act on: "insufficient funds" and "wrong PIN" need different things said to
 * the patient standing at the desk.
 */

export type PaymentRecordScreenProps = {
  intent: PaymentIntent
  /** Present only for a succeeded attempt, and null when the receipt call itself failed. */
  receipt: Receipt | null
  /** This screen's own path, for the attestation form to return to. */
  selfPath: string
  /** Set after a successful attestation, from the redirect. */
  attested?: boolean | undefined
  /** One of a closed set; anything else is ignored. See `problemNotice`. */
  problem?: string | undefined
  /** The API's own sentence, carried back from the failed attempt. */
  message?: string | undefined
}

export function PaymentRecordScreen({
  intent,
  receipt,
  selfPath,
  attested,
  problem,
  message,
}: PaymentRecordScreenProps) {
  const amount = moneyFrom(intent.amount)
  const canAttest = isCash(intent.method) && isUnresolved(intent.status)
  const paid = isSucceeded(intent.status)

  return (
    <div className="grid">
      <PageHeader
        /* The title IS the aggregator's reference, and it is set in the monospaced face for
           the reason console.css gives beside `.ref-title`: it is copied, read aloud and
           compared character by character against another screen. `PageHeader` takes a
           string title by construction — that is what guarantees one <h1> per page — so the
           face is asked for on the header rather than wrapped around the words. */
        className="ref-title"
        eyebrow="Payment record"
        title={intent.reference}
        description={
          <>
            {methodLabel(intent.method)}
            {amount === null ? null : (
              <>
                {' · '}
                <Money value={amount} />
              </>
            )}
          </>
        }
        actions={<PaymentStatusBadge status={intent.status} />}
      />

      {attested === true ? (
        /*
         * `info` AND NOT A SUCCESS TONE, BECAUSE `Notice` HAS NONE. The component offers
         * neutral, info, warn and bad — packages/ui has deliberately not grown a green
         * notice, and adding one is a change to a package four apps share rather than
         * something to slip in from a screen. The heading and `announce` carry the outcome
         * to a screen reader either way, which is the part that has to work.
         */
        <Notice tone="info" title="Recorded" announce>
          <p>
            This payment is marked as paid in cash at the clinic, under your name. The audit
            log has the entry.
          </p>
        </Notice>
      ) : null}

      {problemNotice(problem, message)}

      <Card as="section">
        <h2 className="title">What we recorded</h2>
        <dl className="grid g-2" style={{ marginTop: 'var(--space-5)' }}>
          <Detail label="Our reference">
            <span className="mono">{intent.reference}</span>
          </Detail>
          <Detail
            label="Aggregator reference"
            hint="Look this up in your own aggregator dashboard."
          >
            {intent.aggregator_reference === null ? (
              <span className="muted">None yet</span>
            ) : (
              <span className="mono">{intent.aggregator_reference}</span>
            )}
          </Detail>
          <Detail label="Amount requested">
            {amount === null ? <span className="muted">Not readable</span> : <Money value={amount} />}
          </Detail>
          <Detail label="How it was paid">{methodLabel(intent.method)}</Detail>
          <Detail label="Started">
            {intent.initiated_at === null ? (
              <span className="muted">Not recorded</span>
            ) : (
              <DateTime value={intent.initiated_at} format="datetime" />
            )}
          </Detail>
          <Detail label="Resolved">
            {intent.resolved_at === null ? (
              <span className="muted">Still open</span>
            ) : (
              <DateTime value={intent.resolved_at} format="datetime" />
            )}
          </Detail>
        </dl>

        {intent.failure_message === null ? null : (
          <div style={{ marginTop: 'var(--space-5)' }}>
            {/* Verbatim from the aggregator. See the header. */}
            <Notice tone="bad" title="What the aggregator said">
              <p>{intent.failure_message}</p>
            </Notice>
          </div>
        )}
      </Card>

      {canAttest ? (
        <Card as="section">
          <h2 className="title">Cash received at the clinic</h2>
          <p className="muted" style={{ marginBottom: 'var(--space-5)' }}>
            Use this when the patient has handed over notes at the counter. No money moves
            through Carevelo; this records that you took it.
          </p>
          <CashAttestation
            intentId={intent.id}
            amount={amount}
            reference={intent.reference}
            selfPath={selfPath}
          />
        </Card>
      ) : null}

      {!canAttest && isUnresolved(intent.status) ? (
        <Notice tone="info" title="This one resolves on its own, or not at all">
          <p>
            {isCash(intent.method)
              ? 'This cash payment has already been resolved, so there is nothing left to record here.'
              : 'A mobile-money or card collection is resolved by the aggregator that took it, or by '
                + 'reconciliation. Nobody at the clinic and nobody at Carevelo can mark it paid by hand '
                + '— that would let the clinic’s books say something the aggregator never confirmed.'}
          </p>
          {statusOf(intent.status) === 'timed_out' ? (
            <p>
              A timeout is not an ending. Reconciliation goes on asking the aggregator for up
              to a day, and a late success will still appear here.
            </p>
          ) : null}
        </Notice>
      ) : null}

      {paid ? <ReceiptCard receipt={receipt} /> : null}

      {paid || statusOf(intent.status) === 'reversed' ? <RefundGuidance /> : null}

      <NonCustodialNotice />
    </div>
  )
}

/**
 * The receipt, which NAMES THE CLINIC AS PAYEE.
 *
 * Carevelo appears on it in no role at all, because the clinic is what received the money:
 * the patient paid the clinic's own merchant account and the aggregator paid the clinic
 * direct. A receipt naming us would be a false document and a claim of custody at once.
 *
 * A NULL RECEIPT DOES NOT REMOVE THE FACT OF PAYMENT. The attempt is the record; the
 * receipt is a rendering of it. If the second call failed, the clinic still needs to see
 * that the patient paid — so this degrades to a line saying the document could not be
 * loaded rather than taking the payment off the screen.
 */
function ReceiptCard({ receipt }: { receipt: Receipt | null }) {
  if (receipt === null) {
    return (
      <Notice tone="warn" title="The receipt could not be loaded">
        <p>
          The payment record above still stands. Try again in a moment; the receipt is
          generated from the same record.
        </p>
      </Notice>
    )
  }

  const amount = moneyFrom(receipt.amount)

  return (
    <Card as="section">
      <h2 className="title">Receipt</h2>
      <p className="muted" style={{ marginBottom: 'var(--space-5)' }}>
        Issued by {receipt.payee.legal_name}. The patient paid your clinic; Carevelo is not
        named on it, because Carevelo did not receive the money.
      </p>
      <dl className="grid g-2">
        <Detail label="Payee">{receipt.payee.name}</Detail>
        <Detail label="Reference">
          <span className="mono">{receipt.reference}</span>
        </Detail>
        <Detail label="Amount">
          {amount === null ? <span className="muted">Not readable</span> : <Money value={amount} />}
        </Detail>
        <Detail label="Paid">
          {receipt.paid_at === null ? (
            <span className="muted">Not recorded</span>
          ) : (
            <DateTime value={receipt.paid_at} format="datetime" />
          )}
        </Detail>
      </dl>
      <p className="fine" style={{ marginTop: 'var(--space-5)' }}>
        {receipt.note}
      </p>
    </Card>
  )
}

/**
 * What went wrong with an attestation, if anything.
 *
 * A CLOSED SET, CHECKED HERE. `problem` arrives from the URL, so it is a value from the far
 * side of the wire and an unrecognised one renders nothing at all rather than being echoed
 * into the page. `message` is only ever shown alongside a problem this screen recognises,
 * which is what keeps a crafted link from putting arbitrary text inside a notice that looks
 * like it came from the clinic's own software.
 */
function problemNotice(problem: string | undefined, message: string | undefined): ReactNode {
  if (problem === undefined) {
    return null
  }

  const detail = message === undefined || message === '' ? null : <p>{message}</p>

  switch (problem) {
    case 'unconfirmed':
      return (
        <Notice tone="warn" title="Nothing was recorded" announce>
          <p>Tick the box to confirm you took the cash yourself, then try again.</p>
        </Notice>
      )
    case 'forbidden':
      return (
        <Notice tone="bad" title="Your role cannot attest cash" announce>
          <p>
            Cash attestation is for the front desk, the pharmacist and the clinic
            administrator. Ask one of them to record it.
          </p>
          {detail}
        </Notice>
      )
    case 'not_found':
      return (
        <Notice tone="bad" title="That payment record is no longer there" announce>
          <p>Reload the page. Nothing was recorded.</p>
        </Notice>
      )
    case 'already_resolved':
      return (
        <Notice tone="warn" title="This payment was already resolved" announce>
          <p>Cash is not received twice. Nothing was recorded.</p>
          {detail}
        </Notice>
      )
    case 'not_cash':
      return (
        <Notice tone="bad" title="Only cash taken at the clinic may be attested" announce>
          {detail}
        </Notice>
      )
    case 'other':
      return (
        <Notice tone="bad" title="Nothing was recorded" announce>
          {detail ?? <p>Try again in a moment.</p>}
        </Notice>
      )
    default:
      return null
  }
}

/**
 * One labelled fact.
 *
 * A <dt>/<dd> pair inside a <div>, which is the one wrapper a <dl> is allowed — and the
 * reason the hint sits INSIDE the <dd> rather than beside it. A stray <span> as a direct
 * child of the div would be invalid markup, and invalid markup inside a <dl> is where
 * assistive technology stops pairing terms with their descriptions.
 */
function Detail({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string | undefined
  children: ReactNode
}) {
  return (
    <div className="stat">
      <dt className="stat__label">{label}</dt>
      <dd>
        {children}
        {hint === undefined ? null : (
          <span className="stat__note" style={{ display: 'block' }}>
            {hint}
          </span>
        )}
      </dd>
    </div>
  )
}
