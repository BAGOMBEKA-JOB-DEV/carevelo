import { getTranslations } from 'next-intl/server'

/**
 * The clinic-quotable reference, on every payment screen without exception.
 *
 * It is on the failure screen and the waiting screen as well as the receipt, because those
 * are the two screens a patient is most likely to be holding when they telephone the
 * clinic — and `merchant_reference` is what lets a member of staff find the same payment on
 * the clinic's own aggregator dashboard without asking us. "A clinic can match every
 * Carevelo payment record to a line on its own aggregator dashboard without asking us" is
 * an acceptance criterion of H5; this is the patient's half of it.
 *
 * Rendered in a monospace-ish, selectable block rather than as prose: it gets read down a
 * phone line, and it gets copied.
 */
export async function ReferenceBlock({ reference, clinic }: { reference: string; clinic: string }) {
  const t = await getTranslations('Payments')

  return (
    <div className="stack" style={{ marginTop: 'var(--space-5)' }}>
      <span className="field__label">{t('reference.label')}</span>
      <strong style={{ fontFamily: 'var(--mono)', letterSpacing: '0.04em' }}>{reference}</strong>
      <span className="field__hint">{t('reference.hint', { clinic })}</span>
    </div>
  )
}
