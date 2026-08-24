import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Button, Card, Choice, Money, Notice, formatMoney, type ChoiceOption } from '@carevelo/ui'
import type { Tenant } from '@/lib/tenant'
import { startPayment } from '../api/paymentIntents'
import type { MoneyAmount, Payable, PaymentMethodValue } from '../api/types'
import { clinicName } from './screen'

/**
 * Choosing how to pay, as a plain form post.
 *
 * ------------------------------------------------------------------
 * NO 'use client', NO useState, NO onSubmit — AND THAT IS A REQUIREMENT, NOT A STYLE.
 *
 * `<form action={serverAction}>` submits natively before the bundle arrives and with
 * JavaScript switched off entirely. The binding constraint on this product is a mid-range
 * Android phone on variable mobile data, and the screen that must work under that constraint
 * more than any other is the one where somebody is trying to pay for medical care. Every
 * client-side alternative — a controlled radio group, a fetch-and-spin submit — makes paying
 * depend on JavaScript having loaded first.
 *
 * THE AMOUNT IS NEVER TYPED BY A PATIENT AND NEVER READ FROM THE URL. It arrives as a prop
 * from the API's own priced resource (a service's `price`, an order's `total`), travels into
 * the server action as an encrypted bound argument rather than as a form field, and goes up
 * as integer minor units. A hidden input holding the amount would be a price a patient can
 * edit with a browser's developer tools.
 *
 * WHY THE PATHS ARE BOUND ARGUMENTS TOO. `redirect()` will happily send somebody to another
 * origin, and an open redirect on a payment screen is a phishing kit with the clinic's own
 * branding on it. Bound arguments are serialised and encrypted by the framework, so they
 * cannot be edited in the page; they are validated as same-origin paths a second time in the
 * action anyway, because a control that costs one line is worth having twice.
 */

export type PaymentMethodChooserProps = {
  tenant: Tenant
  /** What is being paid for. An appointment or a dispense order, from the route. */
  payable: Payable
  /** The price, as the API stated it. Integer minor units — never a decimal, never a string. */
  amount: MoneyAmount
  /**
   * Where to send the patient once the attempt exists. MUST contain the literal `{id}`,
   * which is replaced with the new intent's id — e.g. `/payments/{id}`.
   */
  statusPathTemplate: string
  /** This screen's own path, so a failure can re-render it with a message. */
  selfPath: string
  /**
   * The id of the attempt being retried, from the route's `after` search parameter.
   *
   * It is what makes the derived idempotency key new — a retry is a new attempt, not a
   * replay — and it is the only reason this screen needs to know anything about a previous
   * one. See api/idempotency.ts.
   */
  after?: string | undefined
  /**
   * Which ways to pay to offer.
   *
   * DEFAULTS TO THE THREE THAT CAN ACTUALLY COMPLETE TODAY. `card` is deliberately not among
   * them: card authorisation is 3-D Secure at the aggregator, and `PaymentIntentResource`
   * carries no authorisation or redirect URL to send the patient to — so a card attempt
   * would create a real record, show a real waiting screen, and wait for something that will
   * never be asked of anybody. That is precisely the dishonest wait the PRD forbids. A route
   * may pass `card` explicitly the day the contract returns somewhere to send them.
   */
  methods?: readonly PaymentMethodValue[] | undefined
  /** A sentence from a failed attempt, arriving back as a search parameter. */
  error?: string | undefined
}

const DEFAULT_METHODS: readonly PaymentMethodValue[] = ['mtn_momo', 'airtel_money', 'cash_at_clinic']

export async function PaymentMethodChooser({
  tenant,
  payable,
  amount,
  statusPathTemplate,
  selfPath,
  after,
  methods = DEFAULT_METHODS,
  error,
}: PaymentMethodChooserProps) {
  const [t, common] = await Promise.all([getTranslations('Payments'), getTranslations('Common')])

  const clinic = clinicName(tenant, common('thisClinic'))

  const options: ChoiceOption[] = methods.map((method) => ({
    value: method,
    label: t(`methods.${method}.label`),
    note: t(`methods.${method}.note`),
  }))

  const context: SubmitContext = {
    payable,
    amountMinor: amount.amount_minor,
    clinic,
    methods: [...methods],
    statusPathTemplate,
    selfPath,
    ...(after === undefined ? {} : { after }),
  }

  return (
    <Card as="section">
      <span className="site-eyebrow">{t('choose.eyebrow')}</span>
      <h1>{t('choose.title')}</h1>
      <p>{t('choose.subtitle', { clinic })}</p>

      {/* `.stat--banded`: air on both sides of the figure, inside a card that has no gap
          of its own. Three payment screens were writing that as `marginBlock` by hand. */}
      <div className="stat stat--banded">
        <span className="stat__label">{t('choose.amountLabel')}</span>
        <span className="stat__value">
          <Money value={amount} />
        </span>
        <span className="stat__note">
          {payable.type === 'appointment' ? t('choose.payableAppointment') : t('choose.payableOrder')}
        </span>
      </div>

      {error === undefined ? null : (
        /* role="alert" via Notice's `bad` tone: the patient arrived back here by a redirect
           they did not ask for, and a screen reader should hear why. */
        <Notice tone="bad" title={t('choose.problem')}>
          {error}
        </Notice>
      )}

      {after === undefined ? null : <Notice tone="info">{t('choose.retrying')}</Notice>}

      {options.length === 0 ? (
        <Notice tone="warn">{t('choose.noMethods', { clinic })}</Notice>
      ) : (
        <form action={submitPayment.bind(null, context)} className="stack">
          <Choice name="method" legend={t('choose.legend')} options={options} required />

          <Button type="submit" variant="brand" size="lg" block>
            {t('choose.submit', { amount: formatMoney(amount) })}
          </Button>
        </form>
      )}

      {/*
       * WHERE THE MONEY GOES, on the screen where it is being asked for. The patient is
       * paying the clinic's own account at a licensed aggregator; this platform is not in
       * that path and takes nothing out of it. Saying so here is not marketing — it is the
       * only place the person handing over money can read it.
       */}
      <p className="muted card__flow">{t('choose.direct', { clinic })}</p>
    </Card>
  )
}

type SubmitContext = {
  payable: Payable
  amountMinor: number
  /** The clinic's name, so the action can write a sentence naming it. */
  clinic: string
  /** The offered list, carried through so the action can refuse anything else. */
  methods: string[]
  statusPathTemplate: string
  selfPath: string
  after?: string
}

/**
 * Record the attempt, then send the patient to the screen that watches it.
 *
 * THE METHOD IS CHECKED AGAINST THE OFFERED LIST. A form field is a value from the far side
 * of the wire, and the API validates `method` only as `required|string` before calling
 * `PaymentMethod::from()` — which throws a raw ValueError on anything unexpected, so an
 * edited radio value becomes a 500 rather than a validation message. Refusing it here keeps
 * a tampered field from reaching that, and keeps this screen from offering a way to pay it
 * was not asked to offer.
 *
 * `redirect()` IS CALLED OUTSIDE ANY try/catch — it works by throwing, and swallowing that
 * throw would leave the patient staring at the form they just submitted.
 */
async function submitPayment(context: SubmitContext, formData: FormData): Promise<void> {
  'use server'

  const t = await getTranslations('Payments')
  const method = String(formData.get('method') ?? '')
  const back = samePath(context.selfPath, '/')

  if (!context.methods.includes(method)) {
    redirect(withError(back, t('errors.generic')))
  }

  const result = await startPayment({
    payable: context.payable,
    amountMinor: context.amountMinor,
    method,
    ...(context.after === undefined ? {} : { after: context.after }),
  })

  if (!result.ok) {
    /*
     * OUR failures, translated; the API's own sentence where it has one worth reading. The
     * two cases with their own copy are the two a patient can act on: the clinic's system
     * refusing the attempt (call the clinic), and the impossible-by-construction key
     * collision (reload, and do not quietly charge again — see api/paymentIntents.ts).
     */
    const message =
      result.reason === 'forbidden'
        ? t('errors.notAllowed', { clinic: context.clinic })
        : result.reason === 'key_reused'
          ? t('errors.keyReused')
          : result.message

    redirect(withError(back, message))
  }

  redirect(
    samePath(context.statusPathTemplate.replace('{id}', encodeURIComponent(result.intent.id)), back),
  )
}

/**
 * A path on this origin, or the fallback.
 *
 * `//evil.example` is a protocol-relative URL and a browser follows it off-site, so the
 * double slash is refused explicitly rather than caught by the leading-slash test.
 */
function samePath(candidate: string, fallback: string): string {
  return candidate.startsWith('/') && !candidate.startsWith('//') ? candidate : fallback
}

/** The same path, carrying a sentence for the patient — preserving any query it already had. */
function withError(path: string, message: string): string {
  const url = new URL(path, 'https://portal.invalid')
  url.searchParams.set('error', message)

  return `${url.pathname}${url.search}`
}
