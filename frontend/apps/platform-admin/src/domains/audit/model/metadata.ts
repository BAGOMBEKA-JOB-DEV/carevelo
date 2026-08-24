import type { AuditEvent } from './types'

/**
 * An event's `metadata`, in a shape a table cell can render.
 *
 * ONLY EVER CALLED FOR A `full` ROW. A clinic's event arrives with `metadata: null` and
 * this returns nothing for it, which is correct and is also not the control: the control is
 * on the API, in `PlatformAuditEventResource`, which never serialises the column for a
 * tenant-owned row. Nothing here is protecting anything, and a reader should not mistake it
 * for a second layer.
 *
 * WHAT IT IS FOR is the platform half of the register — a break-glass grant's scope, a
 * sign-in's method, a provisioning outcome. Those are the fields somebody reviewing
 * Carevelo's own week actually reads, and burying them behind a link would make the review
 * a series of clicks.
 *
 * VALUES ARE RENDERED, NEVER INTERPRETED. `metadata` is `jsonb` and its TypeScript type is
 * accordingly `unknown` per key, so anything that is not a string, number or boolean is
 * shown as its type rather than stringified: `[object Object]` in an audit register is
 * worse than saying "there is an object here", and `JSON.stringify` on an unknown depth
 * would put a paragraph in a table cell.
 */
export type MetadataPair = {
  readonly key: string
  readonly value: string
}

export function metadataPairs(event: AuditEvent): readonly MetadataPair[] {
  const metadata = event.metadata

  if (metadata === null || metadata === undefined) {
    return []
  }

  return Object.entries(metadata).map(([key, value]) => ({
    key,
    value: describe(value),
  }))
}

function describe(value: unknown): string {
  if (value === null) return '—'
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `${value.length} items`

  return 'object'
}
