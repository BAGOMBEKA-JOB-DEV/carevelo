import { redirect } from 'next/navigation'
import { Button, Inline, Money, Notice, formatMoney } from '@carevelo/ui'
import { attestCash } from '../api/paymentIntents'
import type { MoneyAmount } from '../api/types'

/**
 * The front desk says, on the record, that cash was received.
 *
 * ------------------------------------------------------------------
 * WHAT THIS CONTROL ACTUALLY IS
 *
 * Not a payment. Nothing moves anywhere when this is pressed: the patient already handed
 * notes to a person standing behind a counter, and no aggregator was ever involved. What is
 * recorded is that a named member of this clinic's staff SAYS SO — and the attribution is
 * the entire value of the record. It is the clinic's own internal control, and honestly the
 * only fraud control this design has to offer, which is why the wording below asks the
 * person to affirm a fact about themselves rather than to "confirm payment".
 *
 * The actor is taken from the authenticated session by the backend's audit log and never
 * from anything this form sends. A self-reported attester is not a control, so there is no
 * name field here and there must not be one.
 *
 * ------------------------------------------------------------------
 * WHY THE CHECKBOX IS NOT CEREMONY
 *
 * `required` on a native checkbox is enforced by the browser with no JavaScript at all, and
 * it turns a single mis-click into two deliberate actions. The thing being written is an
 * audit event naming a colleague; an accidental one is a colleague accused of attesting
 * cash they never saw. Two actions is the cheapest possible protection against that and it
 * costs a person one tap.
 *
 * NO 'use client', NO useState, NO onSubmit — AND THAT IS A REQUIREMENT, NOT A STYLE.
 * `<form action={serverAction}>` submits natively before any bundle arrives and with
 * JavaScript switched off entirely. A front desk on a mid-range Android handset over
 * variable mobile data must be able to record a cash payment while the page is still
 * loading its scripts.
 *
 * @see backend/app/Http/Controllers/Api/V1/PaymentIntentController.php — attestCash()
 */

export type CashAttestationProps = {
  intentId: string
  /** The amount the record says was due. Read from the API, never typed by a person. */
  amount: MoneyAmount | null
  /** The payment reference, so the affirmation names the record it is about. */
  reference: string
  /**
   * Where to send the person afterwards — this screen's own path.
   *
   * A BOUND ARGUMENT RATHER THAN A FORM FIELD. `redirect()` will happily send somebody to
   * another origin, and an open redirect on a payments screen is a phishing kit with the
   * clinic's own branding on it. Bound arguments are serialised and encrypted by the
   * framework so they cannot be edited in the page; it is validated as a same-origin path
   * in the action anyway, because a control this cheap is worth having twice.
   */
  selfPath: string
}

export function CashAttestation({ intentId, amount, reference, selfPath }: CashAttestationProps) {
  const context: AttestContext = { intentId, selfPath }

  return (
    <form action={submitAttestation.bind(null, context)} className="stack">
      <Notice tone="warn" title="Only press this if you took the cash yourself">
        <p>
          This records that <strong>you</strong> received this money, under your name, in a
          log nobody at this clinic or at Carevelo can edit or delete afterwards. It does not
          move any money and it cannot be undone.
        </p>
      </Notice>

      {/* The flex row is a `<span>` INSIDE the label rather than the label itself, because
          Inline's `as` list is a set of semantic grouping elements and `label` is not one of
          them — a label's job is association with a control, and a primitive that offered it
          as a layout container would invite one wrapping several. Clicking anywhere in the
          span still toggles the box: it is inside the label.

          `align="start"` because the sentence wraps to three lines at the counter's window
          width and a checkbox centred against three lines sits beside the wrong one.
          `wrap={false}` because the box and its sentence are the atomic pair Inline's
          docblock describes — allowed to wrap, the sentence drops underneath the checkbox
          and the two stop reading as one statement. */}
      <label>
        <Inline as="span" gap="3" align="start" wrap={false}>
          <input type="checkbox" name="attested" value="yes" required />
          <span>
            I received{' '}
            {amount === null ? (
              <strong>the amount on this record</strong>
            ) : (
              <strong>
                <Money value={amount} />
              </strong>
            )}{' '}
            in cash at the clinic for payment <span className="mono">{reference}</span>.
          </span>
        </Inline>
      </label>

      <div>
        <Button type="submit" variant="primary">
          {amount === null
            ? 'Record this cash payment'
            : `Record ${formatMoney(amount)} received in cash`}
        </Button>
      </div>
    </form>
  )
}

type AttestContext = {
  intentId: string
  selfPath: string
}

/**
 * Record the attestation, then re-render the screen it came from.
 *
 * `redirect()` IS CALLED OUTSIDE ANY try/catch — it works by throwing, and swallowing that
 * throw would leave the person staring at the form they just submitted with no idea whether
 * it worked.
 *
 * The outcome travels back as search parameters rather than as component state, because
 * there is no client component here to hold state. `problem` is one of a closed set the
 * screen knows how to render; `message` is the API's own sentence and is shown verbatim,
 * because on a 409 it explains something the person needs — that this attempt was already
 * resolved, or that it was never a cash payment to begin with.
 */
async function submitAttestation(context: AttestContext, formData: FormData): Promise<void> {
  'use server'

  const back = samePath(context.selfPath)

  // The browser enforces `required`, and this enforces it again for anything that posted
  // the form without one. An attestation is not something to record on an empty affirmation.
  if (formData.get('attested') !== 'yes') {
    redirect(`${back}?problem=unconfirmed`)
  }

  const result = await attestCash(context.intentId)

  if (!result.ok) {
    redirect(`${back}?problem=${result.reason}&message=${encodeURIComponent(result.message)}`)
  }

  redirect(`${back}?attested=1`)
}

/**
 * A path this app may send somebody to, or the section's own landing page.
 *
 * Same-origin means it starts with a single '/'. `//evil.example` is a protocol-relative
 * URL that browsers treat as another origin, which is exactly the payload an open-redirect
 * check has to refuse, and it is why the second character is tested rather than only the
 * first.
 */
function samePath(candidate: string): string {
  return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : '/payments'
}
