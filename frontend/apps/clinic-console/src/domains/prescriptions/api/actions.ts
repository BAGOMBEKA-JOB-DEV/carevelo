'use server'

import { issuePrescription, type IssueOutcome } from './prescriptions'
import type { DraftItem } from '../model/items'
import { problemsWith } from '../model/items'

/**
 * The one thing the BROWSER is allowed to ask this domain.
 *
 * Everything else here is a native form post to an inline server action closed over what the
 * server rendered with. This one is a module-level `'use server'` export because the
 * prescribing form is a client component and that is the only way client code can call across
 * the boundary — see `PrescribingForm` for why that component earns its directive.
 *
 * THE ITEMS COME FROM THE BROWSER AND ARE NOT TRUSTED. They are validated here as well as in
 * the form, and then again by `StorePrescriptionRequest`, and the two preconditions that
 * actually matter — may this clinician prescribe, and did this consultation end in a way that
 * permits it — are settled by `Prescription::issue()` where they hold for every caller. The
 * `consultationId` is an argument to an authorised write: row-level security decides which
 * consultation exists, and one belonging to another clinic simply does not.
 *
 * IT RETURNS A RESULT AND THROWS NOTHING. A thrown server action in a client component becomes
 * an error boundary, and an error boundary at the moment a clinician presses "issue" leaves
 * them with no idea whether a prescription now exists.
 */
export async function issue(
  consultationId: string,
  items: readonly DraftItem[],
): Promise<IssueOutcome> {
  const problems = problemsWith(items)

  if (problems.length > 0) {
    return {
      kind: 'problem',
      message: problems[0]?.message ?? 'The prescription is not complete.',
    }
  }

  return issuePrescription(consultationId, items)
}
