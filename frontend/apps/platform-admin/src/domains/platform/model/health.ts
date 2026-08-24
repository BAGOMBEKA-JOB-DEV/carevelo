import type { Health } from './types'

/**
 * Reading the health payload without asserting more than it says.
 *
 * ============================================================
 * THE `isolation_enforced` FIELD IS TYPED TWO WAYS AND THIS IS NOT A TIDY-UP
 * ============================================================
 *
 * The contract describes `data.database` as a union:
 *
 *   { role: string; isolation_enforced: string }
 *   | { role: null;   isolation_enforced: boolean }
 *
 * so the same assertion arrives as a boolean on one branch and as a string on the other.
 * That is a defect in docs/40-api/openapi.yaml — one branch was annotated `type: string`
 * where it plainly means a boolean — and it is reported rather than papered over, because
 * of WHAT the field asserts.
 *
 * `isolation_enforced` is the answer to "is PostgreSQL row-level security actually on".
 * RLS is the layer that holds when the ability check and the policy check both have a bug;
 * docs/40-api/authentication-and-sessions.md calls it the control and the other two
 * "good error messages". A screen that coerced this field with `Boolean(value)` would
 * report the string `"false"` as ENFORCED, because every non-empty string is truthy — the
 * one reading that turns a red alarm into a green tick.
 *
 * So the coercion is explicit and refuses to guess. Anything it does not recognise comes
 * back as `null`, and the screen renders the raw value beside the word "unrecognised"
 * rather than picking a side. An operator reading "unrecognised: maybe" learns something
 * true; an operator reading a green tick learns something false.
 */
export type Isolation =
  | { readonly known: true; readonly enforced: boolean }
  | { readonly known: false; readonly raw: string }

const TRUE = new Set(['true', '1', 'yes', 'on', 'enforced'])
const FALSE = new Set(['false', '0', 'no', 'off', 'not enforced'])

export function isolation(database: Health['database']): Isolation {
  const value = database.isolation_enforced

  if (typeof value === 'boolean') {
    return { known: true, enforced: value }
  }

  const normalised = value.trim().toLowerCase()

  if (TRUE.has(normalised)) {
    return { known: true, enforced: true }
  }

  if (FALSE.has(normalised)) {
    return { known: true, enforced: false }
  }

  return { known: false, raw: value }
}

/**
 * The tenant counts, as ordered rows rather than an object.
 *
 * `data.tenants` is `Record<string, number>` in the contract — an open map, because the
 * API sends whatever states it actually has — so the screen cannot assume the five states
 * it knows about are all present, or that nothing else is. This returns the known states
 * in lifecycle order with a zero where the API sent nothing, followed by anything it did
 * send that this build has never heard of. A state nobody rendered is a clinic nobody
 * counted.
 */
export function tenantCounts(
  tenants: Health['tenants'],
  known: readonly string[],
): readonly { readonly status: string; readonly count: number; readonly recognised: boolean }[] {
  const rows = known.map((status) => ({
    status,
    count: tenants[status] ?? 0,
    recognised: true,
  }))

  const extra = Object.entries(tenants)
    .filter(([status]) => !known.includes(status))
    .map(([status, count]) => ({ status, count, recognised: false }))

  return [...rows, ...extra]
}
