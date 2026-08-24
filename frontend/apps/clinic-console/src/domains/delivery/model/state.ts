import type { Delivery } from './types'

/**
 * What a dispatch action did.
 *
 * NOT IN api/actions.ts BY NECESSITY. That file carries `'use server'`, and a module with
 * that directive may export only async functions — every export becomes a callable
 * endpoint, so a plain object export is a build error. `IDLE` is a runtime value, so it
 * lives here. The failure is at `next build` and not at `tsc`, which is exactly why it is
 * worth a comment rather than a shrug.
 *
 * A state rather than a thrown error, for the same reason as the pharmacy bench: a throw
 * becomes the framework's error boundary, which loses everything the dispatcher typed and
 * says nothing useful. `message: null` means the request never reached the API.
 */
export type DispatchState =
  | { status: 'idle' }
  | { status: 'done'; delivery: Delivery }
  | { status: 'refused'; message: string | null; fields?: Record<string, string> }

export const IDLE: DispatchState = { status: 'idle' }
