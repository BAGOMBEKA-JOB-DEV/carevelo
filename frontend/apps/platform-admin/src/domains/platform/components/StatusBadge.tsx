import { Badge } from '@carevelo/ui'
import { STATUS_ICON, STATUS_TONE, knownStatus } from '../model/status'

/**
 * A clinic's lifecycle state, as a word first and a colour second.
 *
 * A STATE THIS BUILD HAS NEVER HEARD OF STILL RENDERS. `PlatformTenantResource.status` is a
 * plain string in the contract while `TenantStatus` is the enum, so the API is free to grow
 * a sixth state before this app knows about it. The unknown case gets the neutral tone and
 * its raw name — an operator reading `winding_down` learns something true, whereas a badge
 * that rendered nothing would have shown them a clinic with no state at all.
 */
export function StatusBadge({ status }: { status: string }) {
  const known = knownStatus(status)

  if (known === null) {
    return <Badge tone="neutral">{status}</Badge>
  }

  const icon = STATUS_ICON[known]

  return (
    <Badge tone={STATUS_TONE[known]} icon={icon}>
      {known}
    </Badge>
  )
}
