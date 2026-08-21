import { Badge, type BadgeTone } from '@carevelo/ui'
import { STATUS_LABELS, type NotificationStatus } from '../api/types'

/**
 * Whether a message got there, as a word rather than a colour.
 *
 * `sent` IS NOT GREEN, AND THAT IS THE WHOLE POINT OF THIS COMPONENT. `sent` means the
 * gateway accepted the message; it says nothing about whether a handset ever received it.
 * Only `delivered` means that, and only where the gateway reports receipts at all. An
 * administrator looking at this screen is usually holding a complaint from a patient who
 * says they were never told — showing `sent` in the same green as `delivered` would answer
 * that complaint with a claim nobody can support.
 *
 * So `sent` is neutral and `delivered` is good, and the labels spell out the difference
 * rather than relying on the reader knowing it.
 *
 * An unrecognised status renders as its raw value under a neutral tone. A status this build
 * has not heard of must not be shown as delivered.
 */
const TONES: Record<NotificationStatus, BadgeTone> = {
  queued: 'info',
  sent: 'neutral',
  delivered: 'good',
  failed: 'bad',
}

export function NotificationStatusBadge({ status }: { status: string }) {
  const known = status in STATUS_LABELS ? (status as NotificationStatus) : null

  if (known === null) {
    return <Badge tone="neutral">{status}</Badge>
  }

  return <Badge tone={TONES[known]}>{STATUS_LABELS[known]}</Badge>
}
