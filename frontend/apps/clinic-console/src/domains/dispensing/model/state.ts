import type { DispenseOrder } from './types'

/**
 * What a bench action did.
 *
 * ------------------------------------------------------------
 * WHY THIS IS NOT IN api/actions.ts, WHERE IT BELONGS BY SUBJECT.
 *
 * That file carries `'use server'`, and a module with that directive may export ONLY async
 * functions — every export becomes a callable endpoint, so a plain object export is a build
 * error rather than a style note. `IDLE` is a runtime value, so it has to live outside.
 *
 * Worth knowing before moving it back: the failure is at build time, not in the editor, and
 * `pnpm typecheck` does not catch it. TypeScript is perfectly happy with a const in a
 * 'use server' file; only `next build` says otherwise.
 *
 * ------------------------------------------------------------
 * WHY EVERY ACTION RETURNS ONE OF THESE INSTEAD OF THROWING.
 *
 * These are `useActionState` states. A thrown error becomes the framework's error boundary,
 * which replaces the bench with an apology and loses everything the pharmacist typed. The
 * API's own sentence is more useful than anything this layer could invent — `ApiError` has
 * already put RFC 9457 problem details through `humanise()`, and this endpoint's refusals
 * are written for exactly this reader: "This order contains a controlled medicine and must
 * be collected in person."
 *
 * `message: null` means the request never reached the API at all. The caller supplies its
 * own sentence in that case, because there is nothing to pass on and inventing detail about
 * a failure we did not observe is how a support call starts.
 */
export type BenchState =
  | { status: 'idle' }
  | { status: 'done'; order: DispenseOrder }
  | { status: 'refused'; message: string | null; fields?: Record<string, string> }

export const IDLE: BenchState = { status: 'idle' }
