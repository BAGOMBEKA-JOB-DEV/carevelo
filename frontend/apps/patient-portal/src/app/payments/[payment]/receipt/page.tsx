import { redirect } from 'next/navigation'
import { clinicMetadata } from '@/lib/metadata'

/**
 * The receipt for a payment, which lives on the payment's own page.
 *
 * A REDIRECT RATHER THAN A SECOND SCREEN, and the reason is the one rule this domain is
 * most careful about: exactly one status means paid. `PaymentStatusPanel` reads the intent
 * and renders the receipt if and only if the status is `succeeded` — an equality, never
 * "not one of the bad ones", so a status added tomorrow is not-paid by default. A route
 * that rendered a receipt card of its own would be a second place in this codebase able to
 * put a receipt in front of a patient, and the two would be free to disagree about what
 * counts as paid. One of those disagreements is a patient shown a receipt for money the
 * clinic never received.
 *
 * THE URL IS KEPT because it is the shape a person guesses and a clinic might send, and a
 * dead link to somebody's receipt is worse than no link. Whoever arrives lands on the
 * payment, which either shows the receipt or says honestly why there is not one yet.
 *
 * NO SESSION CHECK AND NO READ HERE: the destination does both, under the caller's own
 * session, and a round trip spent only to decide whether to redirect buys nothing on a
 * handset. The redirect happens for an identifier that exists and for one that never did,
 * so it discloses nothing either way.
 */
export default async function ReceiptPage({
  params,
}: {
  params: Promise<{ payment: string }>
}) {
  const { payment } = await params

  redirect(`/payments/${encodeURIComponent(payment)}`)
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
