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
    /*
     * SURVIVING INLINE STYLES, both of them, and both for reasons that outlast this sweep.
     *
     * THE MARGIN. This block is dropped into the middle of a `.card` on five payment
     * screens, and `.card` lays its children out as a block with no gap of its own — so
     * the 16px above this is a property of where it lands, not of what it contains, and
     * there is no column here for a `<Stack>` gap to be. `.stack` still does the work
     * INSIDE it: the three lines are 6px apart, which is that class's own default.
     *
     * THE TRACKING. A payment reference is not prose. It is read out down a telephone,
     * digit by digit, to a member of staff looking for the same string on the clinic's
     * aggregator dashboard, and 0.04em is what separates a run of monospace characters
     * enough to be dictated without being re-read. `.mono` in the token layer sets the
     * face and nothing else; the tracking has no class, and inventing `.identifier` for
     * it is not free — the console already writes `className="identifier"` on a `<dd>`
     * against a rule that does not exist anywhere in the token layer, so defining that
     * name here would silently restyle a screen this sweep does not own. Reported instead.
     */
    <div className="stack" style={{ marginTop: 'var(--space-5)' }}>
      <span className="field__label">{t('reference.label')}</span>
      <strong className="mono" style={{ letterSpacing: '0.04em' }}>
        {reference}
      </strong>
      <span className="field__hint">{t('reference.hint', { clinic })}</span>
    </div>
  )
}
