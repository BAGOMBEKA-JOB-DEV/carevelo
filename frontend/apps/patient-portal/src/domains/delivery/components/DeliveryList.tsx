import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Badge, Card, DateTime, EmptyState, Icon, Inline, Notice, Stack } from '@carevelo/ui'
import { SitePageHeader } from '@/components/SitePageHeader'
import { deliveryStatusTone, deliveryStatusWord } from './status'
import { lastMovedAt } from '../api/deliveries'
import type { DeliveryListResult } from '../api/deliveries'

/**
 * The patient's own deliveries, newest first — the screen that makes tracking findable.
 *
 * THE TRACKING PAGE HAS EXISTED FOR SOME TIME AND NOBODY COULD REACH IT. A patient may
 * `track` a delivery they hold the identifier for, and until `DeliveryController::index()`
 * grew its patient branch nothing they were allowed to call ever handed them one. So the
 * journey opened from a link the clinic sent, or not at all, and a patient who lost the
 * message lost the package. This list is the entry point that closes that.
 *
 * A SERVER COMPONENT, WITH NO CLIENT BOUNDARY ANYWHERE UNDER IT. Nothing on this screen
 * reacts to anything: it is a list, a status word, a time and a link. The tracking page
 * refreshes itself because a package is moving while it is open; a LIST does not need to,
 * and putting the message formatter and a refresh loop into the bundle for it would spend a
 * patient's data on a screen they pass through in two seconds.
 *
 * THE THREE STATES ARE KEPT APART DELIBERATELY. A failed request renders a `Notice`, an
 * empty list renders an `EmptyState`, and neither may stand in for the other —
 * `EmptyState`'s own documentation makes the argument, and here it is at its sharpest: a
 * patient who reads "nothing is on its way to you" when the truth is that the API did not
 * answer is a patient who goes out.
 *
 * WHAT THE ROW SAYS, AND EVERYTHING IT DELIBERATELY DOES NOT. A reference, a milestone word
 * and when the package last moved. No address — a patient does not need their own address
 * read back to them, and this is the screen most likely to be open on a shared handset. No
 * rider's name, which would be a disclosure about the RIDER and serves nobody. No
 * `failure_reason`: it is not clinical and the patient is entitled to it, but "refused" or
 * "recipient_unreachable" against a row is a statement about a household legible to anybody
 * holding the phone, so it is on the tracking screen — deliberately opened — where the
 * clinic's telephone number can sit beside it and lead somewhere. And no contents, ever:
 * `PatientDeliveryResource` has no field that could carry one.
 */
export async function DeliveryList({
  result,
  clinic,
  basePath = '/deliveries',
}: {
  result: DeliveryListResult
  /** The clinic's trading name. Resolved by the route, which already has the tenant. */
  clinic: string
  /**
   * Where a row links to, and where the cursor links point back at. A string rather than
   * a function so nothing here has to be serialisable across a boundary it does not have.
   */
  basePath?: string | undefined
}) {
  const t = await getTranslations('Delivery')

  return (
    <section aria-labelledby="deliveries-title">
      {/* `SitePageHeader` owns both of this header's distances and owns them separately —
          see PrescriptionList for the whole argument. `id` goes on the `<h1>` so the
          `<section>` above stays named by it. */}
      <SitePageHeader
        id="deliveries-title"
        eyebrow={t('trackingEyebrow')}
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
      ) : result.page.deliveries.length === 0 ? (
        /* No `action`: a patient cannot request a delivery from here. It begins with the
           fulfilment choice on a dispensed order, so the empty state says where that is
           rather than offering a button that does not exist. */
        <EmptyState icon="truck" title={t('listEmptyTitle')}>
          {t('listEmptyBody', { clinic })}
        </EmptyState>
      ) : (
        <>
          {/* A real list, so a screen reader announces "list, 3 items" and a patient can
              jump between rows. `Stack as="ul"` removes the user agent's markers and
              indent — and puts `role="list"` back on, which Safari drops the moment
              `list-style` goes. */}
          <Stack as="ul" gap="4">
            {result.page.deliveries.map((delivery) => {
              const moved = lastMovedAt(delivery)

              return (
                <Card as="li" key={delivery.id} padding="tight">
                  <div className="row-wrap between">
                    <div className="stack grow">
                      <Inline gap="3">
                        <Badge tone={deliveryStatusTone(delivery.status)}>
                          {t(deliveryStatusWord(delivery.status))}
                        </Badge>
                        <span className="fine tnum">
                          {t('trackingReference', { reference: delivery.reference })}
                        </span>
                      </Inline>

                      {/* Labelled, because a bare time in a list of records is ambiguous:
                          a patient cannot tell "when it was sent" from "when it arrived",
                          and those are different facts about a package that failed. */}
                      <span className="stat__label">{t('lastUpdateLabel')}</span>
                      <span className="stat__value stat__value--sm">
                        {/* A dash, never a substituted "now". `lastMovedAt()` returns null
                            for a delivery whose thread has not been written yet, and a
                            made-up time here is a patient told their package moved when
                            it did not. */}
                        {moved === null ? '—' : <DateTime value={moved} />}
                      </span>

                      {/* `delivered_at` only where it is real. It is null for a delivery
                          that failed and for one returned to the pharmacy — by definition,
                          not by omission — so the line is absent rather than dashed on
                          exactly the rows where a dash would read as a missing arrival. */}
                      {delivery.delivered_at ? (
                        <span className="fine">
                          {t('deliveredLabel')} <DateTime value={delivery.delivered_at} />
                        </span>
                      ) : null}
                    </div>

                    {/* next/link rather than <Button href>: this is an in-app navigation
                        and should be prefetched and client-routed where JavaScript has
                        arrived, while remaining an ordinary anchor where it has not. */}
                    <Link
                      className="lnk"
                      href={`${basePath}/${encodeURIComponent(delivery.id)}`}
                    >
                      {t('follow')} <Icon name="arrowRight" size={16} />
                    </Link>
                  </div>
                </Card>
              )
            })}
          </Stack>

          {/* 18px between the list and its pager, as a margin — `.card__section` — because
              the list above is a `<Stack>` whose gap is the distance between ROWS, and that
              is a different decision which must not follow this one. `<Inline
              justify="between">` is the row itself, wrapping rather than pushing "Older"
              off a 360px screen. */}
          <Inline
            as="nav"
            justify="between"
            aria-label={t('paginationLabel')}
            className="card__section"
          >
            {/*
             * CURSORS, NEVER PAGE NUMBERS. The dispatcher is assigning and riders are
             * moving packages through the same table while the patient reads it, which is
             * exactly the traffic under which an offset paginator duplicates and skips
             * rows — and a skipped row here is a delivery nobody goes to the gate for. The
             * value is opaque: fed back exactly as received, never parsed, incremented or
             * constructed.
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
