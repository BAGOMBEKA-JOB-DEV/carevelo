import { getTranslations } from 'next-intl/server'
import { Button, Card, Inline, Notice } from '@carevelo/ui'
import { ReferenceBlock } from './ReferenceBlock'
import { clinicName, methodKeyOf, type PaymentScreenProps } from './screen'

/**
 * `failed` — the aggregator gave an explicit answer, and the answer was no.
 *
 * ------------------------------------------------------------------
 * THE AGGREGATOR'S OWN WORDS, VERBATIM, AND NOT PARAPHRASED.
 *
 * `failure_message` is rendered exactly as it arrived. Only the aggregator knows why a
 * mobile-money collection failed, and the difference between "insufficient funds",
 * "wrong PIN" and "transaction not permitted for this account" is the difference between
 * three completely different next actions for the person holding the handset. A tidier
 * sentence of our own — "your payment could not be completed" — throws away the only part
 * they can act on, and it would be OUR guess presented in the aggregator's authority.
 *
 * `humanise()` from @carevelo/api-client is not used here and must not be: that function is
 * for OUR problem documents, the ones this portal's own API calls return. This string is
 * data on a resource, not an error from a request this page made, and it is passed through
 * untouched. (Note that the same rule already runs the other way inside `humanise`, which
 * returns `aggregator_message` first and unaltered.)
 *
 * IT IS ATTRIBUTED, which is the other half of quoting somebody. The line above it names
 * the provider, so a patient reading "insufficient funds" knows that is MTN talking about
 * their account and not this portal talking about anything of ours.
 *
 * WHAT IS NOT CLAIMED HERE: that no money left the patient's account. We cannot know that.
 * The aggregator told us the collection failed and that is all we have — so the copy says
 * to call the clinic with the reference if money did move, which is the one action that can
 * actually resolve it. The clinic can see its own records; we cannot.
 */
export async function PaymentFailed({ tenant, intent, checkAgainHref, retryHref }: PaymentScreenProps) {
  const [t, common] = await Promise.all([getTranslations('Payments'), getTranslations('Common')])

  const clinic = clinicName(tenant, common('thisClinic'))
  const method = t(`methods.${methodKeyOf(intent.method)}.label`)
  const reason = intent.failure_message

  return (
    <Card as="section">
      <span className="site-eyebrow">{t('status.failed')}</span>
      <h1>{t('failed.title')}</h1>

      {reason === null ? (
        <Notice tone="bad">{t('failed.noReason', { method })}</Notice>
      ) : (
        <Notice tone="bad" title={t('failed.saidBy', { method })}>
          {/*
           * A <blockquote> because it is a quotation, and marking it as one is the
           * accessible way to say "these are somebody else's words" to a screen reader as
           * well as to an eye. Rendered as text, never as markup: React escapes it, which
           * matters for a string that originates outside this system entirely.
           */}
          {/* `.quote` clears the user agent's 40px inline margin on a `<blockquote>`,
              which the reset leaves alone — see tokens/components.css. Without it the
              aggregator's own sentence sits inset from the notice that frames it. */}
          <blockquote className="quote">{reason}</blockquote>
        </Notice>
      )}

      <p className="card__flow">{t('failed.money', { clinic })}</p>
      <p>{t('failed.next')}</p>

      <ReferenceBlock reference={intent.reference} clinic={clinic} />

      {/* `<Inline>` for the row — it wraps rather than pushing the primary action off the
          right edge of a 360px phone — and `.card__section` for the 18px above it, which is
          a space AROUND the row and so is not a gap any column can hold. */}
      <Inline gap="4" className="card__section">
        {retryHref === undefined ? null : (
          <Button href={retryHref} variant="brand" size="lg">
            {t('actions.tryAgain')}
          </Button>
        )}

        <Button href={checkAgainHref ?? ''} variant="quiet">
          {t('actions.checkAgain')}
        </Button>
      </Inline>
    </Card>
  )
}

/**
 * `reversed` — it went through, and then it was taken back.
 *
 * Rare, and always handled by a person: the PRD flags it prominently and gives it to the
 * clinic administrator rather than to any automatic path. There is nothing for the patient
 * to press here, so this screen offers no retry — starting a fresh collection on top of a
 * reversal, without knowing why the reversal happened, is how a confused situation becomes
 * an expensive one. It gives them the reference and the clinic's number.
 */
export async function PaymentReversed({ tenant, intent, checkAgainHref }: PaymentScreenProps) {
  const [t, common] = await Promise.all([getTranslations('Payments'), getTranslations('Common')])

  const clinic = clinicName(tenant, common('thisClinic'))
  const method = t(`methods.${methodKeyOf(intent.method)}.label`)
  const phone = tenant.contact.phone

  return (
    <Card as="section">
      <span className="site-eyebrow">{t('status.reversed')}</span>
      <h1>{t('reversed.title')}</h1>

      <Notice tone="bad" icon="help">
        {t('reversed.body', { method, clinic })}
      </Notice>

      <ReferenceBlock reference={intent.reference} clinic={clinic} />

      {/* `<Inline>` for the row — it wraps rather than pushing the primary action off the
          right edge of a 360px phone — and `.card__section` for the 18px above it, which is
          a space AROUND the row and so is not a gap any column can hold. */}
      <Inline gap="4" className="card__section">
        {phone === null ? null : (
          <Button href={`tel:${phone}`} variant="brand" size="lg">
            {t('actions.callClinic', { clinic, phone })}
          </Button>
        )}

        <Button href={checkAgainHref ?? ''} variant="quiet">
          {t('actions.checkAgain')}
        </Button>
      </Inline>
    </Card>
  )
}
