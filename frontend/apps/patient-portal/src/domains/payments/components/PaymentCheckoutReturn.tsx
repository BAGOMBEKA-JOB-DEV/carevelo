import { getTranslations } from 'next-intl/server'
import { Button, Card, Inline, Money, Notice, formatMoney } from '@carevelo/ui'
import { moneyFrom } from '../api/types'
import { ReferenceBlock } from './ReferenceBlock'
import { StatusRefresher } from './StatusRefresher'
import { clinicName, type PaymentScreenProps } from './screen'

/**
 * The patient is back from the aggregator's page, and nobody has told us how it ended.
 *
 * ------------------------------------------------------------------
 * THIS SCREEN MUST NOT SAY THEY DID NOT PAY, AND THE FIRST DRAFT OF IT DID.
 *
 * It is tempting to read "they are here rather than there" as "they gave up", and the copy
 * originally did: "you are back here, so it did not finish. Nothing has been paid yet." That
 * is a claim this app has no way to make. A Pesapal intent is created `initiated` and stays
 * `initiated` until an IPN prompts the backend to re-read GetTransactionStatus — the
 * notification carries no status of its own, by Pesapal's design — and the callback puts the
 * patient's browser back here at once, typically ahead of that round trip.
 *
 * So `initiated` + a stored checkout URL is BOTH the abandoned checkout and the successful
 * one whose confirmation has not caught up, and they are indistinguishable from here. Telling
 * the second patient that nothing has been paid, under a heading saying they did not finish,
 * with "Continue on the payment page" as the loudest button, is an instruction to pay twice.
 * PaymentUnresolved's rule governs this screen for exactly the same reason it governs that
 * one: where the answer is not known, say that, and never manufacture the negative.
 *
 * ------------------------------------------------------------------
 * WHY THIS IS NOT PaymentWaiting.tsx WITH DIFFERENT WORDS.
 *
 * PaymentWaiting is built around a push: something has been asked of a handset, the patient
 * has a PIN to enter, and every sentence on it — "check your phone", "a request should
 * appear", "if no request reaches your phone" — is true only because that is what is
 * happening. On a hosted-checkout aggregator NONE of it is. The collection is a page on the
 * aggregator's own origin; no handset has been asked anything; and a patient sitting here
 * watching a phone is a patient who will still be watching it in an hour. Describing one
 * model in the other's words is the exact failure this domain's PRD calls out — an honest
 * wait is the requirement, and an honest wait about the wrong thing is not honest.
 *
 * So this screen says the true thing: you were sent to a payment page, we have not been told
 * how it ended, and here is that same page again if you still need it.
 *
 * ------------------------------------------------------------------
 * IT IS PaymentUnresolved.tsx'S SIBLING, AND THAT IS THE FAMILY IT BELONGS TO.
 *
 * Same class of outcome — we do not know whether this money moved, and the patient must not
 * assume either way — so the same three obligations are carried over from that file: the
 * heading does not claim a result, the reference is on the screen because the patient may be
 * about to telephone the clinic with it, and "do not pay for this again" is said plainly
 * rather than implied. What differs is the CAUSE and therefore the next action. A timeout
 * has no page left to return to and its screen offers a telephone call; a checkout that may
 * have been abandoned still has one, and offering it back — rather than a fresh order — is
 * what this screen adds.
 *
 * THE SAME PAGE, NEVER A NEW ONE. `payment_intents.redirect_url` is stored server-side for
 * precisely this — "a patient who closes the tab can be sent back to the same page rather
 * than having a second order submitted against their name". A "start again" button in the
 * primary position would submit that second order, and two orders against one appointment is
 * a refund made by hand at the clinic's own aggregator, because Carevelo holds nothing to
 * give back from. Starting again is offered, once, quietly, with the warning attached — the
 * shape PaymentUnresolved settled on for the same trade-off.
 *
 * NO SECOND POLLING MECHANISM. `StatusRefresher` is the domain's one timer and it re-runs
 * this route's server render, so a payment finished on the aggregator's page — or confirmed
 * late by the reconciliation poll — reaches this screen without the patient doing anything.
 * A checkout that was actually completed usually resolves within seconds of the callback.
 */
export async function PaymentCheckoutReturn({
  tenant,
  intent,
  checkAgainHref,
  retryHref,
  checkoutUrl,
  collecting = false,
}: PaymentScreenProps & {
  /** The aggregator's own page for THIS order. Absolute, and already checked twice. */
  checkoutUrl: string
  /**
   * `pending` rather than `initiated`: the aggregator has begun collecting, so an answer is
   * genuinely on its way and re-checking is the better of the two actions. Both states are
   * the same screen because the patient's situation is the same one — they are here, and the
   * payment is not finished.
   */
  collecting?: boolean | undefined
}) {
  const [t, common] = await Promise.all([getTranslations('Payments'), getTranslations('Common')])

  const clinic = clinicName(tenant, common('thisClinic'))
  const money = moneyFrom(intent.amount)
  // An em dash rather than a zero, for the reason PaymentWaiting gives: the contract types
  // this field opaquely, and a fabricated 0 on a payment screen is worse than a visible gap.
  const amount = money === null ? '—' : formatMoney(money)

  return (
    <Card as="section">
      <span className="site-eyebrow">
        {collecting ? t('status.pending') : t('status.initiated')}
      </span>
      <h1>{collecting ? t('checkout.titleCollecting') : t('checkout.titleUnfinished')}</h1>

      <p>
        {collecting
          ? t('checkout.ledeCollecting', { clinic })
          : t('checkout.ledeUnfinished', { clinic, amount })}
      </p>

      {money === null ? null : (
        /* `.stat--banded` gives the figure air on both sides inside a card that has no gap
           of its own — the same one every payment screen uses. */
        <div className="stat stat--banded">
          <span className="stat__label">{t('choose.amountLabel')}</span>
          <span className="stat__value">
            <Money value={money} />
          </span>
        </div>
      )}

      <Notice tone="warn" icon="shield">
        {t('checkout.doNotPayTwice', { clinic })}
      </Notice>

      <p className="card__flow">{t('checkout.notPaidYet')}</p>

      <ReferenceBlock reference={intent.reference} clinic={clinic} />

      {/*
       * `<Inline>` for the row — it wraps rather than pushing the primary action off the
       * right edge of a 360px phone — and `.card__section` for the 18px above it, which is a
       * space AROUND the row and so is not a gap any column can hold.
       *
       * "CHECK AGAIN" IS THE PRIMARY ACTION IN BOTH STATES, AND IT DID NOT USED TO BE.
       *
       * The obvious arrangement is the one PaymentNotStarted uses — lead with the useful
       * next act, which for an unfinished checkout looks like the way back to the page. It
       * is wrong here, because of WHICH STATUS a patient who has just paid actually arrives
       * on. `PaymentIntentController::store` creates a Pesapal intent as `initiated` and
       * NOTHING moves it until the IPN lands and the backend re-reads GetTransactionStatus;
       * `show()` does not re-fetch. Pesapal's callback returns the browser immediately. So
       * `initiated` + a checkout URL is the state of an abandoned checkout AND of a
       * successful one whose confirmation is still in flight, and this screen cannot tell
       * them apart — see the lede, which no longer pretends it can.
       *
       * Given that, the loudest control on the screen must be the one that is safe under
       * both readings. Asking again resolves a payment that already succeeded and costs a
       * patient who abandoned nothing but a tap. Leading with "Continue on the payment page"
       * sends somebody who has already paid back to pay again, which is the one outcome this
       * domain cannot undo. The way back is still here, full size and first in the row —
       * it is simply not the thing shouting.
       *
       * IT IS A PLAIN ANCHOR TO ANOTHER ORIGIN, which is what `<Button href>` renders. No
       * `target="_blank"`: a patient returned by the aggregator's callback should land back
       * on THIS page in THIS tab, and a second tab is how somebody ends up with two views of
       * one payment and pays on both. No `rel="noreferrer"` either — `Referrer-Policy:
       * same-origin` is set for the whole portal in next.config.ts, so no path of ours
       * travels to the aggregator regardless, and `noopener` is meaningless without a new
       * browsing context to open.
       */}
      <Inline gap="4" className="card__section">
        <Button href={checkoutUrl} variant="quiet" size="lg">
          {t('checkout.continue')}
        </Button>

        <Button href={checkAgainHref ?? ''} variant="brand" size="lg">
          {t('actions.checkAgain')}
        </Button>
      </Inline>

      <p className="muted card__flow">{t('checkout.checking')}</p>

      {retryHref === undefined ? null : (
        /* A section of its own rather than another paragraph: it is a second, weaker offer,
           and `.card__section`'s 18px is what says so. The same shape as PaymentUnresolved,
           for the same reason — a fresh attempt is a real cost, not a convenience. */
        <div className="card__section">
          <Notice tone="neutral" title={t('checkout.startAgainTitle')}>
            <div className="stack">
              <span>{t('checkout.startAgain', { clinic })}</span>
              <span>
                <Button href={retryHref} variant="quiet">
                  {t('actions.tryAgain')}
                </Button>
              </span>
            </div>
          </Notice>
        </div>
      )}

      <StatusRefresher active />

      {/*
       * THE FLOOR, FOR A BROWSER WITH NO JAVASCRIPT AT ALL — the same one PaymentWaiting
       * carries, for the same reader on the same connection, and see that file for the whole
       * argument including why the raw string is not parsed into a hoistable <meta>.
       *
       * It matters more here than there, if anything: this reader has just come back from
       * another origin, so the bundle they might have had is gone and the page they land on
       * is a cold one.
       */}
      <noscript dangerouslySetInnerHTML={{ __html: '<meta http-equiv="refresh" content="20">' }} />
    </Card>
  )
}
