import { getTranslations } from 'next-intl/server'
import { Button, Card, Notice } from '@carevelo/ui'
import { ReferenceBlock } from './ReferenceBlock'
import { StatusRefresher } from './StatusRefresher'
import { clinicName, methodKeyOf, type PaymentScreenProps } from './screen'

/**
 * `timed_out` — and the whole of this screen is about NOT calling that a failure.
 *
 * ------------------------------------------------------------------
 * A TIMEOUT IS NOT AN ENDING.
 *
 * The backend moves a pending intent to `timed_out` after an hour without an answer, and
 * that status is explicitly not final: `PaymentIntentStatus::allowedTransitions()` lets it
 * go to `succeeded`, and the reconciliation poll goes on asking the aggregator for up to
 * twenty-four hours precisely because late mobile-money confirmations are ordinary in this
 * market. "Treating `timed_out` as definitive failure produces the worst outcome available:
 * a patient charged for a booking that was cancelled on our side."
 *
 * So every word here is chosen to be unresolved rather than negative. The heading says we
 * do not know. The body says this is not a failure and gives the reason. And the patient is
 * asked NOT to pay again yet — because if the first attempt did land, a second one takes
 * the money twice, and Carevelo has nothing to give back from.
 *
 * A retry is still offered, because forcing somebody to wait a day for medicine is its own
 * harm, but it is the quiet button and it is preceded by the plain statement that the
 * earlier attempt may still complete on its own.
 *
 * THE SAME SCREEN SERVES A STATUS WE DO NOT RECOGNISE. If the API ever reports something
 * this build has never heard of, "we cannot tell" is the only honest rendering — and it is
 * emphatically not "paid".
 */
export async function PaymentUnresolved({
  tenant,
  intent,
  checkAgainHref,
  retryHref,
  recognised = true,
}: PaymentScreenProps & { recognised?: boolean | undefined }) {
  const [t, common] = await Promise.all([getTranslations('Payments'), getTranslations('Common')])

  const clinic = clinicName(tenant, common('thisClinic'))
  const method = t(`methods.${methodKeyOf(intent.method)}.label`)
  const phone = tenant.contact.phone

  return (
    <Card as="section">
      <span className="site-eyebrow">{recognised ? t('status.timed_out') : t('status.unknown')}</span>
      <h1>{recognised ? t('unresolved.title') : t('unknownState.title')}</h1>

      <p>{recognised ? t('unresolved.lede', { method }) : t('unknownState.body', { clinic })}</p>

      <Notice tone="warn" icon="shield">
        {t('unresolved.doNotPayTwice')}
      </Notice>

      <p style={{ marginTop: 'var(--space-5)' }}>{t('unresolved.callClinic', { clinic })}</p>

      <ReferenceBlock reference={intent.reference} clinic={clinic} />

      <div className="row-wrap" style={{ marginTop: 'var(--space-6)' }}>
        <Button href={checkAgainHref ?? ''} variant="brand" size="lg">
          {t('actions.checkAgain')}
        </Button>

        {phone === null ? null : (
          <Button href={`tel:${phone}`} variant="quiet">
            {t('actions.callClinic', { clinic, phone })}
          </Button>
        )}
      </div>

      {retryHref === undefined ? null : (
        <div style={{ marginTop: 'var(--space-6)' }}>
          <Notice tone="neutral" title={t('unresolved.tryAnywayTitle')}>
            <div className="stack">
              <span>{t('unresolved.tryAnyway')}</span>
              <span>
                <Button href={retryHref} variant="quiet">
                  {t('actions.tryAgain')}
                </Button>
              </span>
            </div>
          </Notice>
        </div>
      )}

      {/*
       * Still worth asking. A late confirmation moves this to `succeeded` without anybody
       * touching the page, and the patient watching it is exactly the person who wants to
       * know first.
       */}
      <StatusRefresher active />
    </Card>
  )
}
