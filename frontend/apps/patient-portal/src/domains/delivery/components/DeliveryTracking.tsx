import { refresh } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import { Badge, Button, Card, DateTime, EmptyState, Icon, Notice } from '@carevelo/ui'
import { isSettled } from '../api/tracking'
import { deliveryStatusTone, deliveryStatusWord } from './status'
import { TrackingAutoRefresh } from './TrackingAutoRefresh'
import type { TrackingResult } from '../api/tracking'

/**
 * Following a package. Status milestones, and nothing else, ever.
 *
 * THIS SCREEN MUST NEVER IMPLY IT KNOWS WHAT IS IN THE PACKAGE, and the endpoint behind it
 * is built so that it cannot: no recipient block, no address, no order contents, not even
 * the free-text note attached to each event, because "free text is where clinical content
 * escapes". `DeliveryPolicy` separates `track` from `view` precisely so the patient can
 * watch their delivery without being handed the record it belongs to. Every wording
 * decision below follows from that — "your package", never "your antibiotics"; a count of
 * steps, never a count of items.
 *
 * It also follows from where this page gets read. A patient checks a delivery on a shared
 * handset, on a boda, in a shop, with somebody standing next to them. The least it
 * discloses the better, and the least it can disclose is a status word and a time.
 *
 * A FAILED DELIVERY GETS SOMETHING TO DO, AND AN HONEST SENTENCE ABOUT MONEY. There is no
 * patient-callable reschedule endpoint in this API — reassignment is a dispatcher's
 * action on the clinic's own board — so this screen does not render a button that would do
 * nothing. It names the clinic and its telephone number, which is the thing that actually
 * works. And on refunds it says what is true: the money went to the clinic's own mobile
 * money account, Carevelo never received it, and only the clinic can send it back.
 */
export async function DeliveryTracking({
  result,
  clinic,
  clinicPhone,
}: {
  result: TrackingResult
  /** The clinic's trading name. Resolved by the route, which already holds the tenant. */
  clinic: string
  /** The clinic's telephone number, where it has published one. */
  clinicPhone?: string | undefined
}) {
  const t = await getTranslations('Delivery')

  if (!result.ok) {
    return (
      /* The API's own sentence when there is one. A 404 covers a delivery that never
         existed and one belonging to another clinic, identically and on purpose. */
      <Notice tone="bad" title={t('unavailableTitle')}>
        {result.message ?? t('unreachable', { clinic })}
      </Notice>
    )
  }

  const { tracking } = result
  const settled = isSettled(tracking.status)

  return (
    <div className="stack" style={{ gap: 'var(--space-7)' }}>
      {/* Mounted only while the package is still moving. A delivered or failed delivery
          cannot change, and polling it spends a patient's data bundle for nothing. */}
      {settled ? null : <TrackingAutoRefresh />}

      <div className="page-head">
        <div className="grow">
          <span className="site-eyebrow">{t('trackingEyebrow')}</span>
          <h1 style={{ marginTop: 'var(--space-4)' }}>{t('trackingTitle')}</h1>
          <p className="tnum">{t('trackingReference', { reference: tracking.reference })}</p>
        </div>

        <Badge tone={deliveryStatusTone(tracking.status)}>
          {t(deliveryStatusWord(tracking.status))}
        </Badge>
      </div>

      {tracking.status === 'failed' ? (
        <Notice tone="bad" title={t('failedDeliveryTitle')}>
          {t('failedDeliveryBody', { clinic })}
        </Notice>
      ) : null}

      {/* The recorded reason, where dispatch left one. It is operational — nobody at the
          address, a wrong number — and it is on the patient-facing endpoint by design.
          Rendered as plain text, never interpreted, and never dressed up as a diagnosis. */}
      {tracking.failure_reason === null ? null : (
        <p className="muted">{t('failedReason', { reason: tracking.failure_reason })}</p>
      )}

      {tracking.status === 'failed' || tracking.status === 'returned_to_pharmacy' ? (
        <Card as="section" aria-labelledby="delivery-next" padding="tight">
          <div className="stack" style={{ gap: 'var(--space-3)' }}>
            <h2 id="delivery-next" className="stat__label">
              {t('rescheduleHeading')}
            </h2>

            {/* Two whole sentences rather than one with a fragment glued on where the
                number goes: a translator handed "on {phone}" in isolation cannot know what
                it attaches to, and in a language whose word order differs it may not
                attach there at all. */}
            <p>
              {clinicPhone === undefined
                ? t('rescheduleNoPhone', { clinic })
                : t('rescheduleCall', { clinic, phone: clinicPhone })}
            </p>

            {/*
             * THE HONEST SENTENCE ABOUT MONEY. Carevelo is non-custodial: payment moves
             * from the patient to the clinic through the clinic's own mobile money
             * account, and we never receive it. So we cannot return it, and a screen that
             * implied otherwise would send a patient to the wrong party and lose them
             * days. The terms of use say the same thing in the same words.
             */}
            <p className="fine">{t('refundHonesty', { clinic })}</p>
          </div>
        </Card>
      ) : null}

      <section aria-labelledby="delivery-milestones" className="stack" style={{ gap: 'var(--space-4)' }}>
        <h2 id="delivery-milestones" className="stat__value" style={{ fontSize: 21 }}>
          {t('milestonesHeading')}
        </h2>

        {tracking.milestones.length === 0 ? (
          <EmptyState icon="truck" title={t('milestonesEmptyTitle')}>
            {t('milestonesEmptyBody', { clinic })}
          </EmptyState>
        ) : (
          /* An ORDERED list: these are steps in sequence, and the element says so to a
             screen reader without the visual order having to be inferred. */
          <ol className="stack" style={{ listStyle: 'none', padding: 0, gap: 'var(--space-3)' }}>
            {tracking.milestones.map((milestone, index) => (
              <li
                className="row-wrap between"
                // The API sends no identifier for a milestone, and two events can share a
                // status after a reassignment — so the position is the only stable key,
                // and this list is append-only and never reordered.
                key={`${milestone.status}-${milestone.occurred_at ?? index}`}
              >
                <span className="row" style={{ gap: 'var(--space-3)' }}>
                  <Icon name="check" className="ico" />
                  {t(deliveryStatusWord(milestone.status))}
                </span>

                {milestone.occurred_at === null ? null : (
                  <DateTime value={milestone.occurred_at} format="datetime" />
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* The disclosure, stated on the screen it is about. */}
      <Notice tone="neutral" icon="shield">
        {t('contentsNote')}
      </Notice>

      {settled ? null : (
        <div className="stack" style={{ gap: 'var(--space-3)' }}>
          {/*
           * A FORM, NOT A LINK. Checking for an update is a POST to a Server Action, so it
           * works with no JavaScript at all: the browser posts, Next re-renders the page
           * server-side, and the patient sees the current state. Where JavaScript has
           * arrived, `refresh()` makes the client router discard its copy and take the
           * fresh render instead, without losing scroll position.
           */}
          <form action={checkForUpdate}>
            <Button variant="quiet" type="submit">
              <Icon name="activity" /> {t('refresh')}
            </Button>
          </form>

          <p className="fine">{t('refreshNote')}</p>
        </div>
      )}
    </div>
  )
}

/**
 * Go and look again.
 *
 * There is nothing to write here — this is a read, expressed as a POST because that is
 * what makes it work without JavaScript. The tracking fetch is uncached, so the re-render
 * genuinely asks the API rather than replaying what it said last time.
 */
async function checkForUpdate(): Promise<void> {
  'use server'

  /*
   * `refresh()` rather than `revalidatePath()`. Nothing on this page is cached on the
   * SERVER — the tracking fetch sends no cache directives and a dynamic render does not
   * store it — so there is no server entry to invalidate and revalidatePath would be
   * aimed at a cache that does not exist. What does hold a stale copy is the CLIENT
   * router, for the patient who has JavaScript; `refresh()` tells it to discard what it
   * is holding and take the render this POST just produced.
   *
   * Imported statically. It was a dynamic `await import('next/cache')`, which read as
   * though something about the module had to be deferred; nothing does — `refresh` is an
   * ordinary export of next/cache — and an import that looks load-bearing when it is not
   * is the kind of thing the next person preserves without knowing why.
   */
  refresh()
}
