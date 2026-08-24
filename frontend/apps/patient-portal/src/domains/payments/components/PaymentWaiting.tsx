import { getTranslations } from 'next-intl/server'
import { Button, Card, Inline, Money, Notice, Spinner, formatMoney } from '@carevelo/ui'
import { isCash, isMobileMoney, moneyFrom } from '../api/types'
import { ReferenceBlock } from './ReferenceBlock'
import { StatusRefresher } from './StatusRefresher'
import { clinicName, methodKeyOf, type PaymentScreenProps } from './screen'

/**
 * The honest wait.
 *
 * ------------------------------------------------------------------
 * THIS SCREEN IS THE POINT OF THE WHOLE DOMAIN.
 *
 * "State moves to pending. This is the normal state, not an edge case, and the UI must be
 * honest about waiting: show what is happening, that the patient should check their phone,
 * and how long it typically takes. A fake progress bar that implies imminent success is
 * worse than an honest wait." — PRD H5, §2.
 *
 * So there is no progress bar, no percentage, no animated bar creeping toward a completion
 * this page cannot predict, and no wording that implies the next second is the one. What
 * there is instead: what has been asked of whom, what the patient has to do with their
 * handset, how long it usually takes, how long we go on asking, and — twice — that nothing
 * is paid yet.
 *
 * THE ONE SPINNER EARNS ITS PLACE and is not a progress indicator: it sits beside the
 * sentence about this page re-checking itself, and it says "a timer is running", which is
 * true. Its accessible label says the same in words.
 *
 * "DO NOT PAY AGAIN" IS ON THE SCREEN, prominently, because the failure this product cannot
 * afford is a patient who is not sure and pays twice. Two collections against one
 * appointment is a refund the clinic has to make by hand through its own aggregator, and
 * Carevelo holds nothing to make it from.
 */
export async function PaymentWaiting({ tenant, intent, checkAgainHref, retryHref }: PaymentScreenProps) {
  const [t, common] = await Promise.all([getTranslations('Payments'), getTranslations('Common')])

  const clinic = clinicName(tenant, common('thisClinic'))
  const method = t(`methods.${methodKeyOf(intent.method)}.label`)
  const money = moneyFrom(intent.amount)
  // An em dash rather than a zero. The contract types this field opaquely (see
  // api/types.ts), and a fabricated 0 on a payment screen is worse than a visible gap.
  const amount = money === null ? '—' : formatMoney(money)
  const onAHandset = isMobileMoney(intent.method)

  return (
    <Card as="section">
      <span className="site-eyebrow">{t('status.pending')}</span>
      <h1>{onAHandset ? t('waiting.title') : t('waiting.titleGeneric')}</h1>

      <p>
        {onAHandset
          ? t('waiting.lede', { method, amount, clinic })
          : t('waiting.ledeGeneric', { method, amount, clinic })}
      </p>

      {money === null ? null : (
        /* `.stat--banded` gives the figure air on BOTH sides inside a card that has no
           gap of its own. It was `style={{ marginBlock: 'var(--space-5)' }}` here and on
           two other payment screens; it is one declaration in tokens/components.css now. */
        <div className="stat stat--banded">
          <span className="stat__label">{t('choose.amountLabel')}</span>
          <span className="stat__value">
            <Money value={money} />
          </span>
        </div>
      )}

      <Notice tone="info" icon="clock" title={t('waiting.howLongTitle')}>
        {t('waiting.howLong')}
      </Notice>

      <p className="card__flow">{t('waiting.notPaidYet', { method })}</p>

      <Notice tone="warn" icon="shield">
        {t('waiting.doNotPayTwice', { clinic })}
      </Notice>

      {onAHandset ? <p className="muted">{t('waiting.noRequest')}</p> : null}

      <ReferenceBlock reference={intent.reference} clinic={clinic} />

      {/* `<Inline>` for the row — it wraps rather than pushing the primary action off the
          right edge of a 360px phone — and `.card__section` for the 18px above it, which is
          a space AROUND the row and so is not a gap any column can hold. */}
      <Inline gap="4" className="card__section">
        <Button href={checkAgainHref ?? ''} variant="brand" size="lg">
          {t('actions.checkAgain')}
        </Button>

        {retryHref === undefined ? null : (
          <Button href={retryHref} variant="quiet">
            {t('actions.tryAgain')}
          </Button>
        )}
      </Inline>

      {/* `wrap={false}`: the spinner and the sentence it is spinning about are one atom,
          and a spinner that has fallen onto its own line is a spinner about nothing. */}
      <Inline as="span" gap="4" wrap={false} className="card__flow">
        <Spinner label={t('waiting.checkingLabel')} />
        <span className="muted grow">{t('waiting.checking')}</span>
      </Inline>

      <StatusRefresher active />

      {/*
       * THE FLOOR, FOR A BROWSER WITH NO JAVASCRIPT AT ALL.
       *
       * StatusRefresher needs the bundle to have arrived; on a mid-range Android on
       * variable mobile data that can be many seconds, and with scripting switched off it
       * never happens. A meta refresh inside <noscript> keeps the page current for exactly
       * that reader and is inert for everyone else, so it cannot fight the timer above.
       *
       * Twenty seconds rather than five: a full document reload costs far more than an RSC
       * payload, and this reader is the one most likely to be on the slowest connection.
       *
       * dangerouslySetInnerHTML for a constant string with nothing interpolated into it,
       * because React 19 hoists a <meta> element it can see into <head> — which would turn
       * a conditional refresh into an unconditional one and reload the page under every
       * patient every twenty seconds. Raw HTML is not parsed, so it stays where it is put.
       */}
      <noscript dangerouslySetInnerHTML={{ __html: '<meta http-equiv="refresh" content="20">' }} />
    </Card>
  )
}

/**
 * `initiated` — the attempt exists in our records and the collection has not begun.
 *
 * TWO GENUINELY DIFFERENT SITUATIONS SHARE THIS STATUS, and telling them apart is the whole
 * job of this component.
 *
 * For CASH AT THE CLINIC this is the normal, expected state and stays that way until a
 * named member of staff attests the money at the desk: no aggregator is involved, nothing
 * is pending on a handset, and the patient's next action is to walk in with the reference.
 *
 * For a mobile-money or card attempt it means the collection never started — the PRD's
 * "aggregator unreachable at initiation" branch. What the patient must be told there is
 * exact and reassuring: nothing was asked of your phone, and no charge was made. Showing
 * them the waiting screen instead would be the fake-progress failure in its worst form,
 * inviting them to watch a handset that is never going to ring.
 */
export async function PaymentNotStarted({ tenant, intent, checkAgainHref, retryHref }: PaymentScreenProps) {
  const [t, common] = await Promise.all([getTranslations('Payments'), getTranslations('Common')])

  const clinic = clinicName(tenant, common('thisClinic'))
  const money = moneyFrom(intent.amount)
  const amount = money === null ? '—' : formatMoney(money)
  const atTheDesk = isCash(intent.method)

  return (
    <Card as="section">
      <span className="site-eyebrow">{t('status.initiated')}</span>
      <h1>{atTheDesk ? t('notStarted.titleCash', { clinic }) : t('notStarted.titleAggregator')}</h1>

      <p>
        {atTheDesk
          ? t('notStarted.bodyCash', { amount })
          : t('notStarted.bodyAggregator', { clinic })}
      </p>

      {money === null ? null : (
        <div className="stat stat--banded">
          <span className="stat__label">{t('choose.amountLabel')}</span>
          <span className="stat__value">
            <Money value={money} />
          </span>
        </div>
      )}

      <ReferenceBlock reference={intent.reference} clinic={clinic} />

      {/* `<Inline>` for the row — it wraps rather than pushing the primary action off the
          right edge of a 360px phone — and `.card__section` for the 18px above it, which is
          a space AROUND the row and so is not a gap any column can hold. */}
      <Inline gap="4" className="card__section">
        <Button href={checkAgainHref ?? ''} variant={atTheDesk ? 'quiet' : 'brand'} size="lg">
          {t('actions.checkAgain')}
        </Button>

        {retryHref === undefined ? null : (
          <Button href={retryHref} variant={atTheDesk ? 'brand' : 'quiet'}>
            {t('actions.tryAgain')}
          </Button>
        )}
      </Inline>

      {/* Cash is confirmed by a person at a desk, so a timer would be asking a question
          nobody is answering on a schedule. The aggregator branch is genuinely re-checkable:
          a retry with backoff happens server-side and the status can move underneath us. */}
      <StatusRefresher active={!atTheDesk} />
    </Card>
  )
}
