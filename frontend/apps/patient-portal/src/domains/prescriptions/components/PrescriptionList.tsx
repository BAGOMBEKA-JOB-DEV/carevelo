import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Badge, Card, DateTime, EmptyState, Icon, Notice } from '@carevelo/ui'
import { statusTone, statusWord } from './status'
import type { PrescriptionListResult } from '../api/prescriptions'

/**
 * The patient's prescriptions, newest first.
 *
 * A SERVER COMPONENT, WITH NO CLIENT BOUNDARY ANYWHERE UNDER IT. Nothing on this screen
 * reacts to anything: it is a list, two links and a status word. Adding `'use client'`
 * here would put the message formatter and this subtree's markup into a bundle a patient
 * on variable mobile data has to download before they can read what they were prescribed.
 *
 * THE THREE STATES ARE KEPT APART DELIBERATELY. A failed request renders a `Notice`, an
 * empty list renders an `EmptyState`, and neither is allowed to stand in for the other —
 * `EmptyState`'s own documentation makes the argument: "a patient will read 'you have no
 * prescriptions' as fact when the truth is that the API did not answer."
 *
 * NO MEDICINE NAMES IN THE LIST. The row carries the date, who wrote it, its status and
 * how many items are on it. That is enough to choose one, and this is the screen most
 * likely to be open on a shared handset or read over a shoulder; the contents are one tap
 * away, behind a deliberate act.
 */
export async function PrescriptionList({
  result,
  clinic,
  basePath = '/prescriptions',
}: {
  result: PrescriptionListResult
  /** The clinic's trading name. Resolved by the route, which already has the tenant. */
  clinic: string
  /**
   * Where a row links to, and where the cursor links point back at. A string rather than
   * a function so nothing here has to be serialisable across a boundary it does not have.
   */
  basePath?: string | undefined
}) {
  const t = await getTranslations('Prescriptions')

  return (
    <section aria-labelledby="prescriptions-title">
      <div className="page-head">
        <div className="grow">
          <span className="site-eyebrow">{t('detailEyebrow')}</span>
          <h1 id="prescriptions-title" style={{ marginTop: 'var(--space-4)' }}>
            {t('listTitle')}
          </h1>
          <p>{t('listLede', { clinic })}</p>
        </div>
      </div>

      {!result.ok ? (
        /* The API's own sentence when there is one — it is phrased so that it never
           confirms a record exists at another clinic, and a rewrite here could undo that
           without anybody noticing. Our wording only covers the case where nothing
           answered at all. */
        <Notice tone="bad" title={t('unavailableTitle')}>
          {result.message ?? t('unreachable', { clinic })}
        </Notice>
      ) : result.page.prescriptions.length === 0 ? (
        /* No `action`: a patient cannot ask for a prescription, and a button here would
           invite them to press something that does not exist. */
        <EmptyState icon="file" title={t('emptyTitle')}>
          {t('emptyBody', { clinic })}
        </EmptyState>
      ) : (
        <>
          {/* A real list, so a screen reader announces "list, 4 items" and a patient can
              jump between rows. The bullets are removed here rather than in the token
              layer because packages/ui has no opinion about lists yet and one inline
              declaration is cheaper than a class nothing else uses. */}
          <ul className="stack" style={{ listStyle: 'none', padding: 0, gap: 'var(--space-4)' }}>
            {result.page.prescriptions.map((prescription) => (
              <Card as="li" key={prescription.id} padding="tight">
                <div className="row-wrap between">
                  <div className="stack grow">
                    <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
                      <Badge tone={statusTone(prescription.status)}>
                        {t(statusWord(prescription.status))}
                      </Badge>
                      <span className="fine">
                        {t('itemCount', { count: prescription.items?.length ?? 0 })}
                      </span>
                    </div>

                    {/* Labelled, because a name on its own in a list of clinical records
                        is ambiguous — the patient's own name would sit in exactly the same
                        place on a screen a member of staff was looking at. */}
                    <span className="stat__label">{t('prescribedByLabel')}</span>
                    <span className="stat__value" style={{ fontSize: 19 }}>
                      {prescription.issued_by.name}
                    </span>

                    <span className="fine">
                      {t('issuedLabel')}{' '}
                      {prescription.issued_at ? (
                        <DateTime value={prescription.issued_at} />
                      ) : (
                        '—'
                      )}
                    </span>
                  </div>

                  {/* next/link rather than <Button href>: this is an in-app navigation and
                      should be prefetched and client-routed where JavaScript has arrived,
                      while remaining an ordinary anchor where it has not. */}
                  <Link className="lnk" href={`${basePath}/${prescription.id}`}>
                    {t('open')} <Icon name="chev" size={16} />
                  </Link>
                </div>
              </Card>
            ))}
          </ul>

          <nav
            aria-label={t('paginationLabel')}
            className="row-wrap between"
            style={{ marginTop: 'var(--space-6)' }}
          >
            {/*
             * CURSORS, NEVER PAGE NUMBERS. The backend pages this queue by cursor
             * precisely because an offset paginator skips rows when new prescriptions
             * arrive mid-read, "and a skipped row here is a prescription nobody
             * dispenses". The value is opaque: it is fed back exactly as received and
             * never parsed, incremented or constructed.
             */}
            {result.page.prevCursor ? (
              <Link className="lnk" href={`${basePath}?cursor=${encodeURIComponent(result.page.prevCursor)}`}>
                {t('newer')}
              </Link>
            ) : (
              <span />
            )}

            {result.page.nextCursor ? (
              <Link className="lnk" href={`${basePath}?cursor=${encodeURIComponent(result.page.nextCursor)}`}>
                {t('older')}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        </>
      )}
    </section>
  )
}
