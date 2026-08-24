import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Badge, Button, Card, Choice, Icon, Money, Notice, Stack, formatMoney } from '@carevelo/ui'
import { SitePageHeader } from '@/components/SitePageHeader'
import { fulfilmentIsStillOpen, hasControlledItem, recordFulfilment } from '../api/fulfilment'
import { localPath } from './localPath'
import type { FulfilmentMethod, OrderResult } from '../api/fulfilment'

/**
 * Where the patient says whether they are collecting or having it brought — and therefore
 * the one place in this product where an address is put on a path towards a stranger.
 *
 * THE CONSENT IS CAPTURED HERE, AT THE POINT OF CHOOSING, AND NOT BEFORE. DPPA 2019
 * requires consent to be SPECIFIC, and `ConsentController` says why `delivery_disclosure`
 * is deliberately absent from registration: "asking up front for a disclosure that may
 * never happen is not specific". So the flow is: choose delivery, agree to your address
 * being given to a rider, then delivery is recorded.
 *
 * THIS DOMAIN DOES NOT WRITE THAT CONSENT, AND MUST NOT. The consent record pins the
 * policy version AND a hash of the exact rendered text the patient read; the patients
 * domain owns that wording, as `ConsentController` owns it on the API side. A second
 * writer here would pin a hash to text it had reproduced by hand — "precisely the failure
 * the hash exists to catch". What this component does instead is take a `deliveryConsent`
 * prop and send the patient there. See the domain's index.ts for exactly what it needs.
 *
 * NO PRE-SELECTED OPTION. `RecordFulfilmentRequest` accepts two values and defines no
 * default, and the reason given there applies with more force to a form: "if the guess
 * were `delivery`, it would be a guess that their address may be shared with a rider."
 *
 * A PLAIN FORM POST. `<form action={serverAction}>` submits natively, so a patient whose
 * bundle has not arrived can still tell the pharmacy how to hand over their medicines.
 * That is also why there is no `'use client'`, no state and no `onChange` in this file.
 */
export async function FulfilmentChoice({
  result,
  clinic,
  selfHref,
  deliveryConsent,
  outsideServiceArea = false,
  error,
}: {
  result: OrderResult
  /** The clinic's trading name. Resolved by the route, which already holds the tenant. */
  clinic: string
  /** This page's own path. The action returns the patient here, with or without an error. */
  selfHref: string
  /**
   * The delivery-disclosure consent, owned by the patients domain.
   *
   * `granted` is what that domain's reader says about this patient TODAY — withdrawal is
   * a new record and the latest one decides, so it is not a fact that can be cached.
   * `href` is the page that captures it, passed whole and used verbatim: this domain makes
   * no assumption about how that page names its return parameter.
   */
  deliveryConsent: { granted: boolean; href: string }
  /**
   * The clinic does not deliver to this patient's address.
   *
   * THE SEAM FOR SOMETHING THE BACKEND DOES NOT MODEL YET. There is no service-area
   * concept anywhere in the API — no coverage table, no district list, no flag on the
   * tenant — so nothing can compute this today and it defaults to false. When coverage is
   * modelled, the route layer passes it and this screen already knows what to do: offer
   * collection, and say why rather than silently omitting an option.
   */
  outsideServiceArea?: boolean | undefined
  /** What the last attempt said, read back off the query string by the route. */
  error?: string | undefined
}) {
  const t = await getTranslations('Delivery')

  if (!result.ok) {
    return (
      /* The API's own sentence when there is one: a 404 here covers an order that never
         existed and one belonging to another clinic, identically and on purpose. */
      <Notice tone="bad" title={t('unavailableTitle')}>
        {result.message ?? t('unreachable', { clinic })}
      </Notice>
    )
  }

  const order = result.order

  // Mirrors DispenseOrder::mayBeDelivered(), which asks the PRESCRIPTION rather than the
  // dispensed items. Asked here so the patient is told before they choose, rather than
  // after submitting — the backend refuses either way, and there is no override.
  const controlled = hasControlledItem(order)
  const deliveryPossible = !controlled && !outsideServiceArea

  const fee = order.delivery_fee

  /*
   * A zero charge is not "free delivery" — it is a charge the pharmacy has not set yet,
   * and printing "free" would be promising something on the clinic's behalf.
   */
  const deliveryNote =
    fee.amount_minor > 0
      ? t('deliveryNoteWithFee', { clinic, fee: formatMoney(fee) })
      : t('deliveryNote')

  return (
    <Stack gap="7">
      {/* `SitePageHeader` rather than an eleventh hand-rolled `.page-head`: it owns the
          12px between the eyebrow and the `<h1>` that was a `marginTop` here, and its
          `title` is typed as a string, so this screen cannot grow a second `<h1>`. */}
      <SitePageHeader
        eyebrow={t('fulfilmentEyebrow')}
        title={t('fulfilmentTitle')}
        description={t('fulfilmentLede', { clinic })}
        actions={
          <Badge tone="neutral" icon="box">
            {t('orderReference', { reference: order.reference })}
          </Badge>
        }
      />

      {error === undefined ? null : (
        /*
         * The API's own words where it gave any. Its refusals are written to be acted on —
         * the controlled-item one names collection as the alternative, because "not
         * permitted" without an alternative is not an answer a patient can use.
         *
         * AN EMPTY STRING IS A REAL CASE, NOT A MISSING ONE: the request never reached the
         * API, so there was no sentence to carry back. Checked against `undefined` rather
         * than for truthiness, because the falsy branch would swallow that failure
         * entirely and leave a patient pressing Confirm with nothing happening.
         */
        <Notice tone="bad" title={t('failedTitle')}>
          {error === '' ? t('failedBody', { clinic }) : error}
        </Notice>
      )}

      <Card as="section" aria-labelledby="order-total" padding="tight">
        <Stack gap="3">
          <h2 id="order-total" className="stat__label">
            {t('totalLabel')}
          </h2>

          <div className="row-wrap between">
            <span className="muted">{t('medicinesLabel')}</span>
            <Money value={order.subtotal} />
          </div>

          <div className="row-wrap between">
            <span className="muted">{t('deliveryChargeLabel')}</span>
            <Money value={fee} />
          </div>

          <div className="row-wrap between">
            <strong>{t('totalLabel')}</strong>
            <strong>
              <Money value={order.total} />
            </strong>
          </div>

          {/* Said plainly on the screen where money first appears. The clinic sets the
              price and receives the payment; Carevelo is not in that path at all. */}
          <p className="fine">{t('pricedByClinic', { clinic })}</p>
        </Stack>
      </Card>

      {controlled ? (
        <Notice tone="warn" icon="shield" title={t('controlledTitle')}>
          {t('controlledBody', { clinic })}
        </Notice>
      ) : null}

      {!controlled && outsideServiceArea ? (
        <Notice tone="info" icon="pin" title={t('outOfAreaTitle')}>
          {t('outOfAreaBody', { clinic })}
        </Notice>
      ) : null}

      {fulfilmentIsStillOpen(order) ? (
        <form action={submitFulfilment}>
          {/* The column is a `<Stack>` INSIDE the form rather than the form itself:
              `Stack`'s element union has no `form` on purpose, and a block form wrapping a
              full-width Stack lays out identically to the `.stack` this was. The hidden
              inputs are `display: none` from the user agent, so they are not flex items and
              cost no gap — which is also true of the `.stack` they used to sit in. */}
          <Stack gap="6">
            <input type="hidden" name="order" value={order.id} />
            <input type="hidden" name="back" value={selfHref} />

            {/*
             * Present ONLY while delivery is genuinely on offer and the consent is genuinely
             * missing. Its presence is what tells the action to send the patient to the
             * consent step instead of posting — so once consent has been given this field is
             * gone, and a controlled-item refusal can no longer bounce anybody back to a
             * consent page they have already completed.
             */}
            {deliveryPossible && !deliveryConsent.granted ? (
              <input type="hidden" name="consent" value={deliveryConsent.href} />
            ) : null}

            <Choice
              name="method"
              legend={t('methodLegend')}
              required
              options={
                deliveryPossible
                  ? [
                      { value: 'pickup', label: t('pickupLabel'), note: t('pickupNote', { clinic }) },
                      {
                        value: 'delivery',
                        label: t('deliveryLabel'),
                        note: deliveryConsent.granted
                          ? deliveryNote
                          : `${deliveryNote} ${t('deliveryNeedsConsent')}`,
                      },
                    ]
                  : [
                      {
                        value: 'pickup',
                        label: t('pickupLabel'),
                        note: t('pickupNote', { clinic }),
                      },
                    ]
              }
              hint={deliveryPossible ? undefined : t('onlyPickupOffered')}
            />

            {/* What the rider is and is not told, next to the option that involves one —
                not in a policy page, and not after the fact. */}
            {deliveryPossible ? (
              <Notice tone="neutral" icon="truck">
                {t('riderKnowsNothing')}
              </Notice>
            ) : null}

            {/* `brand`: a patient surface paints with the CLINIC's colour, and takes its
                foreground from --brand-primary-fg, which the backend computed for AA. */}
            <Button variant="brand" size="lg" type="submit">
              <Icon name="check" /> {t('confirm')}
            </Button>
          </Stack>
        </form>
      ) : (
        <Decided fulfilment={order.fulfilment} clinic={clinic} />
      )}
    </Stack>
  )
}

/**
 * What was chosen, once choosing is over.
 *
 * A form here would offer something the state machine refuses: past `out_for_delivery` or
 * `collected` the fulfilment method is a fact about what happened, not a preference.
 */
async function Decided({
  fulfilment,
  clinic,
}: {
  fulfilment: string | null
  clinic: string
}) {
  const t = await getTranslations('Delivery')

  if (fulfilment === 'delivery') {
    return (
      <Notice tone="info" icon="truck" title={t('chosenDeliveryTitle')}>
        {t('chosenDeliveryBody', { clinic })}
      </Notice>
    )
  }

  if (fulfilment === 'pickup') {
    return (
      <Notice tone="info" icon="box" title={t('chosenPickupTitle')}>
        {t('chosenPickupBody', { clinic })}
      </Notice>
    )
  }

  // Null: the order moved on without anybody recording how it was handed over. Said
  // plainly rather than guessed at — a guess here is a patient waiting at home for a
  // package that is sitting on a shelf with their name on it.
  return (
    <Notice tone="warn" icon="help" title={t('notDecidedTitle')}>
      {t('notDecidedBody', { clinic })}
    </Notice>
  )
}

/**
 * The posted method, or null.
 *
 * Narrowed from `unknown` rather than checked on a `string`, and that is not a stylistic
 * preference: excluding two literals from `string` leaves `string`, so a pair of `!==`
 * guards would compile and hand an unchecked value to the API client. Comparing against
 * `unknown` narrows properly, which is what makes the return type mean something.
 */
function toMethod(value: unknown): FulfilmentMethod | null {
  return value === 'pickup' || value === 'delivery' ? value : null
}

/**
 * Record the choice, or send the patient to give consent first.
 *
 * THE ORDER OF THE TWO BRANCHES IS THE PRODUCT RULE. Consent comes before the word
 * `delivery` is ever sent, so a patient who has not agreed is never the subject of a
 * refused delivery request — they are asked the question the refusal exists to make
 * somebody ask. The API enforces the same rule independently: this is the courteous path
 * to it, not the control.
 */
async function submitFulfilment(formData: FormData): Promise<void> {
  'use server'

  const orderId = String(formData.get('order') ?? '').trim()
  const method = toMethod(formData.get('method'))
  const back = localPath(String(formData.get('back') ?? ''))
  const consentHref = String(formData.get('consent') ?? '')

  /*
   * Neither can happen through the form — the identifier is fixed and the radio group is
   * `required` — so anything caught here is a hand-crafted post, and it gets nothing.
   *
   * TWO STATEMENTS, AND `redirect` IMPORTED STATICALLY, BOTH SO THE COMPILER CAN SEE THAT
   * `method` IS NON-NULL BELOW. TypeScript only treats a call as ending the flow when the
   * callee is a plain imported binding annotated `never` — a `const { redirect } = await
   * import(...)` has an INFERRED type and does not qualify — and narrowing does not
   * survive a `||`. Get either wrong and this compiles with `method` still nullable,
   * which is the compiler declining to check the one thing worth checking here.
   */
  if (orderId === '') {
    redirect(back)
  }

  if (method === null) {
    redirect(back)
  }

  if (method === 'delivery' && consentHref !== '') {
    // Straight to the consent step. Not posted first: a POST that is going to be refused
    // for want of consent buys nothing but a round trip and an error the patient did
    // nothing to deserve.
    redirect(localPath(consentHref))
  }

  const written = await recordFulfilment(orderId, method)

  if (written.ok) {
    redirect(back)
  }

  /*
   * The API's own sentence, carried back in the query string, which is how the sign-in
   * form does it and for the same reason: a native form post is a new document, so there
   * is nowhere else for it to live without JavaScript.
   *
   * Bounded, because a query parameter is something a crafted link can also set: what
   * arrives is rendered as the body of an error notice on the clinic's own domain, and a
   * long enough string is a page someone else wrote. React escapes it, so this is a
   * plausibility limit rather than an injection defence.
   */
  const message = (written.message ?? '').slice(0, 300)

  redirect(`${back}?fulfilmentError=${encodeURIComponent(message)}`)
}
