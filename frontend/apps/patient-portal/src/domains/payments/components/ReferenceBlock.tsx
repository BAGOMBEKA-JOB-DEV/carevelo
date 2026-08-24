import { getTranslations } from 'next-intl/server'
import { Stack } from '@carevelo/ui'

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
     * THE TRACKING IS `.reference` NOW, in tokens/components.css. A payment reference is
     * read out down a telephone, character by character, to a member of staff looking for
     * the same string on the clinic's aggregator dashboard, and 0.04em is what separates a
     * run of monospace glyphs enough to be dictated without being re-read.
     *
     * The class is NOT called `.identifier`, which is the obvious name: the console
     * already writes `className="identifier"` on a `<dd>` in ConsentDeskScreen.tsx against
     * a rule that exists nowhere in the token layer, and defining that name would have
     * restyled a screen this sweep does not own. That dangling class is reported instead.
     */
    <Stack gap="2" className="card__flow">
      <span className="field__label">{t('reference.label')}</span>
      <strong className="mono reference">{reference}</strong>
      <span className="field__hint">{t('reference.hint', { clinic })}</span>
    </Stack>
  )
}
