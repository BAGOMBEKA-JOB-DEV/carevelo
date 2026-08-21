import { Notice } from '@carevelo/ui'
import type { Attempt } from '../api/http'
import { accessProblem } from './screen'

/**
 * A read that failed, said out loud.
 *
 * WHY EVERY SCREEN IN THIS DOMAIN HAS ONE. Settings is where a clinic decides whether the
 * product is credible, and the two commonest first impressions are a clinician who
 * followed the nav link and is not an administrator, and an administrator whose session
 * quietly expired while they were reading. Both used to be a blank panel. A blank panel on
 * the branding screen is indistinguishable from a product that does not work.
 *
 * It is a `Notice` and not an `EmptyState` because it is not empty — something went wrong,
 * and the tone should say so. `announce` is on for the bad case so a screen reader hears
 * it rather than finding it later by touch.
 */
export function AccessNotice({
  failure,
  context,
}: {
  failure: Extract<Attempt<unknown>, { ok: false }>
  /** What could not be loaded, in the administrator's words: "the staff list". */
  context: string
}) {
  const problem = accessProblem(failure)

  return (
    <Notice tone={problem.tone} title={problem.title} announce={problem.tone === 'bad'}>
      <p>{problem.body}</p>
      <p className="fine">Carevelo could not load {context}.</p>
    </Notice>
  )
}
