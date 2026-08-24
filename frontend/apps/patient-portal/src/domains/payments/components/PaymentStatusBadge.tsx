import { getTranslations } from 'next-intl/server'
import { Badge, type BadgeTone } from '@carevelo/ui'
import { statusOf, type PaymentIntent, type PaymentStatusValue } from '../api/types'

/**
 * A payment's state, in one word, for a list.
 *
 * THE TONES ARE NOT DECORATION. `timed_out` is amber and not red, because it is not a
 * failure and colouring it as one would contradict the screen it links to. `initiated` is
 * neutral, because for cash at the clinic it is simply where the record sits until somebody
 * pays at the desk. Only `succeeded` is green, and it is the only value that may be.
 *
 * A status this build does not recognise renders as "Unknown" rather than throwing or
 * falling through to something reassuring.
 */
const TONES: Record<PaymentStatusValue, BadgeTone> = {
  initiated: 'neutral',
  pending: 'warn',
  succeeded: 'good',
  failed: 'bad',
  timed_out: 'warn',
  reversed: 'bad',
  unknown: 'neutral',
}

export async function PaymentStatusBadge({ intent }: { intent: PaymentIntent }) {
  const t = await getTranslations('Payments')
  const status = statusOf(intent)

  return <Badge tone={TONES[status]}>{t(`status.${status}`)}</Badge>
}
