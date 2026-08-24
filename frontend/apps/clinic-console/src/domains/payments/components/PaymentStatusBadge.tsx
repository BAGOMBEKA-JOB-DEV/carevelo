import { Badge, type BadgeTone } from '@carevelo/ui'
import { statusOf, type PaymentStatusValue } from '../api/types'

/**
 * A payment attempt's status, as a word rather than a colour.
 *
 * The badge convention exists because a coloured dot is unreadable to a colour-blind
 * pharmacist and invisible to a screen reader. The tone is a second channel, never the only
 * one.
 *
 * `timed_out` IS NOT RED, AND THAT IS THE POINT OF THIS COMPONENT. A timeout is not a
 * failure: reconciliation goes on asking the aggregator for up to a day afterwards and can
 * still move the attempt to succeeded. Rendering it as a failure would have the front desk
 * turning away a patient whose money is on its way, so it is a warning — something to come
 * back to — and its label says which.
 *
 * An unrecognised status renders as "Unknown", never as anything reassuring. A status this
 * build has not heard of must not be shown as paid.
 */

const PRESENTATION: Record<PaymentStatusValue, { label: string; tone: BadgeTone }> = {
  initiated: { label: 'Initiated', tone: 'info' },
  pending: { label: 'Awaiting the patient', tone: 'info' },
  succeeded: { label: 'Paid', tone: 'good' },
  failed: { label: 'Failed', tone: 'bad' },
  timed_out: { label: 'Timed out — not final', tone: 'warn' },
  reversed: { label: 'Reversed', tone: 'bad' },
  unknown: { label: 'Unknown', tone: 'neutral' },
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const presentation = PRESENTATION[statusOf(status)]

  return <Badge tone={presentation.tone}>{presentation.label}</Badge>
}
