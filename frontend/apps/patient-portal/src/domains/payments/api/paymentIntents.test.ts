import { describe, expect, it } from 'vitest'
import { handoffFor } from './paymentIntents'
import type { PaymentIntent } from './types'

/*
 * Which of the two payment models an attempt is in, tested as the honesty property it is.
 *
 * ------------------------------------------------------------------
 * WHAT GOES WRONG WHEN THIS IS WRONG, WHICH IS NOT A CRASH.
 *
 * Every case below compiles, lints clean and renders a perfectly normal-looking screen
 * whether the decision is right or wrong. What a wrong answer costs is a patient acting on
 * a false sentence:
 *
 *  - Told to check a handset that will never buzz, they wait — sometimes for an hour, in a
 *    pharmacy queue — while the payment page they were meant to finish on sits one tap away.
 *  - Sent to a payment page for an attempt that already succeeded, they pay a second time
 *    for one appointment. The money is at the clinic's own account at the clinic's own
 *    aggregator; Carevelo holds nothing to give back, and the refund is a person at a desk
 *    and a telephone call to an aggregator.
 *
 * Neither is visible to tsc. Both are one assertion each.
 *
 * ------------------------------------------------------------------
 * WHY THE FIXTURE CASTS, WHEN THE FIELD IS IN THE CONTRACT.
 *
 * `PaymentIntentResource` types `redirect_url` as `string | null`, and most of what is below
 * could be written without a cast. Several cases could not: a number, a `javascript:` URL and
 * a relative path are values the contract says cannot arrive, and they are exactly the values
 * `checkoutUrlOf` exists to survive. A test that could only express in-contract values would
 * be a test of the type checker rather than of the code, and this runs on a wire where the
 * far side is a different language, a different deployment and — for the next few weeks — a
 * different agent's work in progress. So `intentWith()` takes anything and casts once, in one
 * place, and every off-contract case says in its own name what it is standing in for.
 *
 * @see ./paymentIntents.ts — the two models, and why the method chosen cannot decide between them
 * @see ../components/PaymentCheckoutReturn.tsx — the screen the abandoned case lands on
 */

/**
 * A payment intent as the API states one, plus whatever this test is about.
 *
 * `amount` is typed `Record<string, never>` by the generator (see ./types.ts) and nothing
 * here reads it, so an empty object is the honest fixture rather than a fabricated figure.
 */
function intentWith(extra: Record<string, unknown>): PaymentIntent {
  return {
    id: '01J8XKQ9Z3MOCKINTENT000001',
    reference: 'CV-PAY-8H3K2M',
    status: 'initiated',
    amount: {},
    method: 'mtn_momo',
    aggregator_reference: null,
    redirect_url: null,
    failure_message: null,
    initiated_at: null,
    resolved_at: null,
    ...extra,
  } as PaymentIntent
}

/** What a hosted-checkout aggregator hands back. The query is the aggregator's own order. */
const CHECKOUT =
  'https://cybqa.pesapal.com/pesapaliframe/PesapalIframe3/Index?OrderTrackingId=PESAPAL-TRACK-0001'

describe('handoffFor', () => {
  /*
   * THE ANSWER DECIDES, NOT THE QUESTION. An intent that came back with somewhere to send
   * the patient is a redirect journey, whatever was chosen on the form.
   */
  it('reads a hosted checkout off the created intent rather than off the method', () => {
    expect(handoffFor(intentWith({ redirect_url: CHECKOUT }))).toEqual({
      kind: 'hosted_checkout',
      url: CHECKOUT,
    })
  })

  /*
   * THE CASE A METHOD-SHAPED RULE WOULD GET WRONG, and the reason there is no such rule.
   * One merchant account per clinic: a clinic whose account is with a hosted-checkout
   * aggregator collects MOBILE MONEY through that aggregator's page too. A lookup table
   * saying "mobile money pushes" would show this patient "check your phone" and leave them
   * watching a handset nobody has asked anything of.
   */
  it('sends a mobile-money attempt to the page when the clinic’s aggregator hosts one', () => {
    const handoff = handoffFor(intentWith({ method: 'airtel_money', redirect_url: CHECKOUT }))

    expect(handoff.kind).toBe('hosted_checkout')
  })

  /*
   * AND THE PUSH MODEL IS WHAT REMAINS. An aggregator that collects by prompting a handset
   * returns no page, and this must stay the behaviour of every clinic already live —
   * PaymentWaiting.tsx is unchanged and this is what still routes to it.
   */
  it('leaves an attempt with no page to be awaited on our own screens', () => {
    expect(handoffFor(intentWith({}))).toEqual({ kind: 'awaited' })
  })

  /*
   * CASH IS ATTESTED BY A PERSON AT A DESK. A cash intent carrying a payment page is a
   * contradiction in the contract, and the safe reading of a contradiction here is to ignore
   * the surprising half: sending somebody to an online payment page for the notes in their
   * hand is how one bill gets paid twice.
   */
  it('refuses a checkout page on a cash attempt, whatever the contract says', () => {
    expect(handoffFor(intentWith({ method: 'cash_at_clinic', redirect_url: CHECKOUT }))).toEqual({
      kind: 'awaited',
    })
  })

  /*
   * THE REPLAY. `POST /v1/payment-intents` returns the STORED response for a repeated
   * Idempotency-Key, so re-submitting the chooser after paying hands back a succeeded intent
   * — with the page it was paid on still recorded against it. Redirecting there invites a
   * second payment for a settled bill, which is the one outcome this domain cannot undo.
   */
  it('never hands off a succeeded attempt, however it still describes its page', () => {
    expect(
      handoffFor(intentWith({ status: 'succeeded', redirect_url: CHECKOUT })),
    ).toEqual({ kind: 'awaited' })
  })

  /*
   * A FAILED OR REVERSED ATTEMPT IS FINISHED WITH ITS PAGE TOO. Both have screens of their
   * own that offer a fresh attempt under a new idempotency key; the old page belongs to the
   * old order.
   */
  it.each(['failed', 'reversed'])('never hands off a %s attempt', (status) => {
    expect(handoffFor(intentWith({ status, redirect_url: CHECKOUT }))).toEqual({ kind: 'awaited' })
  })

  /*
   * `timed_out` IS EXCLUDED FROM THE OTHER END, and not because it is a failure — it is not,
   * and PaymentUnresolved.tsx exists to say so. The order has aged out at the aggregator, so
   * the page is no longer the way to finish, and that screen's whole argument is that the
   * patient should not start paying again yet.
   */
  it('sends a timed-out attempt to the unresolved screen rather than back to the page', () => {
    expect(handoffFor(intentWith({ status: 'timed_out', redirect_url: CHECKOUT }))).toEqual({
      kind: 'awaited',
    })
  })

  /*
   * A STATUS THIS BUILD HAS NEVER HEARD OF IS NEVER A REDIRECT. Same rule as `isPaid`: a
   * state added to the backend tomorrow must land on the honest "we cannot tell" screen, not
   * on a payment page.
   */
  it('refuses to hand off a status it does not recognise', () => {
    expect(handoffFor(intentWith({ status: 'part_settled', redirect_url: CHECKOUT }))).toEqual({
      kind: 'awaited',
    })
  })

  /*
   * ABANDONED CHECKOUT. A patient who closes the aggregator's tab and comes back is read
   * again from `GET /v1/payment-intents/{id}`, still unresolved and still carrying the same
   * page — and they must be offered THAT page rather than a new one. A second order against
   * their name is precisely what the stored URL exists to prevent
   * (`add_pesapal_collection_columns`), and the resume link on PaymentCheckoutReturn is
   * built from this value.
   */
  it('offers an abandoned checkout the same page it left, in both unresolved states', () => {
    for (const status of ['initiated', 'pending']) {
      expect(handoffFor(intentWith({ status, redirect_url: CHECKOUT }))).toEqual({
        kind: 'hosted_checkout',
        url: CHECKOUT,
      })
    }
  })

  /*
   * AND THE PAGE COMES BACK BYTE FOR BYTE. The query string IS the order — it is the only
   * thing the aggregator's notification carries — so a URL that arrived re-encoded or
   * truncated is a patient returned to somebody else's payment, or to nothing.
   */
  it('preserves the aggregator’s own query, which is the order itself', () => {
    const handoff = handoffFor(intentWith({ redirect_url: CHECKOUT }))

    expect(handoff.kind === 'hosted_checkout' && handoff.url).toContain(
      'OrderTrackingId=PESAPAL-TRACK-0001',
    )
  })

  /*
   * THE SECOND COPY OF THE OPEN-REDIRECT CONTROL. The backend refuses a URL that is not
   * https and not on the aggregator's host; this refuses anything that is not an absolute
   * http(s) URL at all. A relative string would navigate inside this portal while the screen
   * said "you are at your bank", and `javascript:` on the one screen that handles money is
   * the whole reason the check is not "does it look like a URL".
   */
  it.each([
    ['a relative path', '/payments/somewhere-else'],
    ['a protocol-relative URL', '//evil.example/checkout'],
    ['a javascript: URL', 'javascript:alert(document.cookie)'],
    ['a data: URL', 'data:text/html,<h1>pay here</h1>'],
    ['plaintext http', 'http://pay.example/checkout'],
    ['an empty string', ''],
    ['whitespace', '   '],
    ['a number', 1234],
    ['null', null],
  ])('refuses %s and waits instead of navigating', (_case, redirect_url) => {
    expect(handoffFor(intentWith({ redirect_url }))).toEqual({ kind: 'awaited' })
  })

  /*
   * PLAINTEXT ON LOOPBACK IS THE ONE EXCEPTION, and it exists so that the local fake
   * gateway drives the REAL redirect path in development rather than a special case nobody
   * exercises until production.
   */
  it('allows a plaintext page on loopback, so the local fake drives the real path', () => {
    const handoff = handoffFor(intentWith({ redirect_url: 'http://localhost:8000/fake-checkout' }))

    expect(handoff.kind).toBe('hosted_checkout')
  })
})
