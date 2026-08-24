import { readClient } from '@/domains/identity'
import type { Health } from '../model/types'

/**
 * System health for a platform operator.
 *
 * COUNTS AND ONE SECURITY ASSERTION. No clinic is singled out and nothing here is about a
 * person — which is what makes this safe to put on the landing screen of a surface whose
 * whole design principle is that it reaches no clinical data.
 *
 * THE INTERESTING NUMBER IS `break_glass.active_grants`, AND IT IS ON THIS ENDPOINT RATHER
 * THAN THE BREAK-GLASS ONE FOR A REASON. The contract puts it beside uptime deliberately:
 * "A rising number of live grants means the metadata-based support tooling is INADEQUATE,
 * not that more access is needed, and a figure nobody sees is a figure nobody acts on." It
 * is a platform-wide figure that does not depend on how somebody paged through the grant
 * register, which is exactly why the break-glass screen takes it from here rather than
 * counting the rows in front of it.
 *
 * NO POLLING, NO SOCKET. docs/30-architecture/frontend-nextjs.md is explicit that platform
 * admin subscribes to nothing tenant-scoped, and there is no platform channel. A live
 * refresh would also be the wrong shape for this figure: it is read as a trend across
 * weeks, not as a dial, and a number that quietly changes under the operator's eyes is a
 * number nobody can cite in a review. It refreshes when the page is loaded, and the page
 * says when it was checked.
 */
export async function getHealth(): Promise<Health> {
  const client = await readClient()
  const response = await client.get<{ data: Health }>('/v1/platform/health')

  return response.data
}
