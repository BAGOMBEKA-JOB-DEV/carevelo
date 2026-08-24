import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Badge, Card, DateTime, EmptyState, Icon, Inline, Money, Notice, Stack } from '@carevelo/ui'
import { SitePageHeader } from '@/components/SitePageHeader'
import { awaitsPayment, orderStatusTone, orderStatusWord } from './status'
import type { OrderListResult } from '../api/orders'

/**
 * The patient's own dispense orders, newest first.
 *
 * THIS IS THE SCREEN THE PORTAL DID NOT HAVE, and its absence is what made two whole
 * journeys unreachable. Paying for a dispensed order and choosing collection or delivery
 * both had pages already; neither had a way in, because the API had no patient-callable
 * listing and so nothing could hand a patient an order identifier. They opened from a link
 * the clinic sent, or not at all. `DispenseOrderController::index()` now branches on
 * `AuthorisesPatientReads`, and this is the entry point that branch was built for.
 *
 * A SERVER COMPONENT, WITH NO CLIENT BOUNDARY ANYWHERE UNDER IT. Nothing on this screen
 * reacts to anything: it is a list, a status word, an amount and two links. Adding
 * `'use client'` here would put the message formatter and this subtree's markup into a
 * bundle a patient on variable mobile data has to download before they can find out what
 * they owe.
 *
 * THE THREE STATES ARE KEPT APART DELIBERATELY. A failed request renders a `Notice`, an
 * empty list renders an `EmptyState`, and neither is allowed to stand in for the other —
 * `EmptyState`'s own documentation makes the argument, and it bites hardest on this screen
 * of all of them: a patient who reads "you have no orders" when the truth is that the API
 * did not answer is a patient who does not go and collect their medicines.
 *
 * NO MEDICINE NAMES IN THE LIST, AND NOT BY OMISSION. The controller does not load the
 * prescription for a patient's listing and gates `substitutions` behind a staff check, so
 * there is no field on these rows that could carry one. The row is a reference, a state, an
 * amount and how the order is being handed over — enough to choose one — and this is the
 * screen most likely to be open on a shared handset or read over a shoulder. What is in the
 * package is one deliberate tap away.
 *
 * WHERE A ROW LINKS IS DECIDED BY ITS STATUS, and there are exactly two destinations. An
 * order waiting for payment links to the payment screen, because that is the one thing the
 * patient can do about it and a list that made them hunt for it would be a list that costs
 * the clinic a collection. Everything else links to the order's own page, which is where
 * the fulfilment choice lives and where — once that choice is a fact rather than a question
 * — it is shown back to them. `awaitsPayment()` in ./status.ts owns that test so it is not
 * a second, invisible copy of the state machine's meaning sitting in this file.
 */
export async function OrderList({
  result,
  clinic,
  basePath = '/orders',
  paymentPathTemplate,
}: {
  result: OrderListResult
  /** The clinic's trading name. Resolved by the route, which already has the tenant. */
  clinic: string
  /**
   * Where a row links to, and where the cursor links point back at. A string rather than
   * a function so nothing here has to be serialisable across a boundary it does not have.
   */
  basePath?: string | undefined
  /**
   * Where a patient pays, with `{id}` standing in for the order — the same shape as
   * `PAYMENT_STATUS_TEMPLATE` in app/paths.ts, and passed by the route for the same reason
   * every other path in this app is: a domain that hard-coded a URL could not be mounted
   * anywhere else, and could not be told where the routing tree actually put the page.
   */
  paymentPathTemplate: string
}) {
  const t = await getTranslations('Dispensing')

  return (
    <section aria-labelledby="orders-title">
      {/* `SitePageHeader` owns both of this header's distances and owns them separately —
          12px from the eyebrow to the `<h1>` from a `<Stack gap="4">` inside it, and 6px
          from the title to the lede left to `.page-head p` by keeping the description
          OUTSIDE that Stack. `id` goes on the `<h1>` so the `<section>` stays named by it. */}
      <SitePageHeader
        id="orders-title"
        eyebrow={t('listEyebrow')}
        title={t('listTitle')}
        description={t('listLede', { clinic })}
      />

      {!result.ok ? (
        /* The API's own sentence when there is one — it is phrased so that it never
           confirms a record exists at another clinic, and a rewrite here could undo that
           without anybody noticing. Our wording only covers the case where nothing
           answered at all. */
        <Notice tone="bad" title={t('unavailableTitle')}>
          {result.message ?? t('unreachable', { clinic })}
        </Notice>
      ) : result.page.orders.length === 0 ? (
        /* No `action`: a patient cannot raise a dispense order. It arrives because a
           clinician prescribed something and the pharmacy took it up, and a button here
           would invite them to press something that does not exist. */
        <EmptyState icon="box" title={t('emptyTitle')}>
          {t('emptyBody', { clinic })}
        </EmptyState>
      ) : (
        <>
          {/* A real list, so a screen reader announces "list, 4 items" and a patient can
              jump between rows. `Stack as="ul"` removes the user agent's markers and
              indent — and puts `role="list"` back on, which Safari drops the moment
              `list-style` goes. */}
          <Stack as="ul" gap="4">
            {result.page.orders.map((order) => {
              const paying = awaitsPayment(order.status)

              return (
                <Card as="li" key={order.id} padding="tight">
                  <div className="row-wrap between">
                    <div className="stack grow">
                      <Inline gap="3">
                        <Badge tone={orderStatusTone(order.status)}>
                          {t(orderStatusWord(order.status))}
                        </Badge>
                        <span className="fine tnum">
                          {t('orderReference', { reference: order.reference })}
                        </span>
                      </Inline>

                      {/* Labelled, because an amount on its own in a list of records is
                          ambiguous — a patient cannot tell what is owed from what was
                          paid, and this is the number they came to the page for. `Money`
                          rather than arithmetic here: the API sends minor units and a
                          currency, and a total formatted by hand is a total that
                          disagrees with the payment screen. */}
                      <span className="stat__label">{t('totalLabel')}</span>
                      <span className="stat__value stat__value--sm">
                        <Money value={order.total} />
                      </span>

                      {/* How it is being handed over, in the patient's terms. `null` is
                          not "pickup" and must never be rendered as one: it means nobody
                          has recorded a choice, and a patient told they are collecting an
                          order that is actually still a question is a patient who makes a
                          wasted journey. */}
                      <span className="fine">{t(handoverKey(order.fulfilment))}</span>

                      <span className="fine">
                        {t('dispensedLabel')}{' '}
                        {order.dispensed_at ? <DateTime value={order.dispensed_at} /> : '—'}
                      </span>
                    </div>

                    {/* next/link rather than <Button href>: this is an in-app navigation
                        and should be prefetched and client-routed where JavaScript has
                        arrived, while remaining an ordinary anchor where it has not. */}
                    <Link
                      className="lnk"
                      href={
                        paying
                          ? paymentPathTemplate.replace('{id}', encodeURIComponent(order.id))
                          : `${basePath}/${encodeURIComponent(order.id)}/fulfilment`
                      }
                    >
                      {paying ? t('pay') : t('open')} <Icon name="arrowRight" size={16} />
                    </Link>
                  </div>
                </Card>
              )
            })}
          </Stack>

          {/* 18px between the list and its pager. The list above is a `<Stack>` whose gap
              is the distance between ROWS — a different decision that must not follow this
              one — and neither element has a column of its own to hold the space, so it is
              a margin still: `.card__section`, the token layer's name for the distance
              above the controls that close a block. `<Inline justify="between">` is the row
              itself, wrapping rather than pushing "Older" off a 360px screen. */}
          <Inline
            as="nav"
            justify="between"
            aria-label={t('paginationLabel')}
            className="card__section"
          >
            {/*
             * CURSORS, NEVER PAGE NUMBERS. The pharmacy is pricing and dispensing into the
             * same table while the patient reads it, which is exactly the traffic under
             * which an offset paginator duplicates and skips rows — and a skipped row here
             * is an order nobody pays for. The value is opaque: fed back exactly as
             * received, never parsed, incremented or constructed.
             */}
            {result.page.prevCursor ? (
              <Link
                className="lnk"
                href={`${basePath}?cursor=${encodeURIComponent(result.page.prevCursor)}`}
              >
                {t('newer')}
              </Link>
            ) : (
              <span />
            )}

            {result.page.nextCursor ? (
              <Link
                className="lnk"
                href={`${basePath}?cursor=${encodeURIComponent(result.page.nextCursor)}`}
              >
                {t('older')}
              </Link>
            ) : (
              <span />
            )}
          </Inline>
        </>
      )}
    </section>
  )
}

/**
 * Which sentence describes how this order is being handed over.
 *
 * THREE ANSWERS, AND THE THIRD IS THE HONEST ONE. `DispenseOrderResource.fulfilment` is
 * `'pickup' | 'delivery' | null` on the wire but typed as a bare `string | null`, so this
 * matches the two values the API actually writes and treats everything else — a null, or a
 * value added to the API after this was written — as "not decided yet". That is the safe
 * direction to be wrong in: telling a patient a choice is still open when it has in fact
 * been made costs them a tap, while telling them their medicines are coming when nobody has
 * arranged it costs them a day at home waiting.
 *
 * The keys are written out rather than built from a template literal, for the reason the
 * account hub gives at length: next-intl's key union does not survive interpolation, so an
 * interpolated key compiles and then resolves at runtime to the literal text
 * `Dispensing.handover.x` printed on a patient's screen.
 */
function handoverKey(fulfilment: string | null): 'handover.pickup' | 'handover.delivery' | 'handover.undecided' {
  if (fulfilment === 'pickup') {
    return 'handover.pickup'
  }

  if (fulfilment === 'delivery') {
    return 'handover.delivery'
  }

  return 'handover.undecided'
}
