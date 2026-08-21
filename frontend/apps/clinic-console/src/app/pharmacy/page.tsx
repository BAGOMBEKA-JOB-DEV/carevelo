import type { Metadata } from 'next'
import { Notice } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'
import { currentStaff, PharmacyQueueScreen } from '@/domains/dispensing'
import { DISPENSING_PATHS } from './paths'

/**
 * The pharmacy queue.
 *
 * THIN BY DESIGN, AND THE BOUNDARY RULES ENFORCE IT. This route resolves the session,
 * decides what an absent one means, and hands off. Every judgement about the queue — which
 * statuses are lanes, what a pharmacist may be offered, how the list stays current — belongs
 * to the dispensing domain, because a rule restated in the routing tree is a rule free to
 * drift from the screen it governs.
 *
 * `active="pharmacy"`: `ConsoleShell` requires the section and accepts `null` for a page
 * that is not one. Saying it here rather than in the layout is the fix that made the nav
 * highlighting work at all — a layout is never told which route is rendering inside it.
 */
export const metadata: Metadata = { title: 'Pharmacy' }

export default async function PharmacyPage() {
  /*
   * A SESSION THAT HAS ENDED IS NOT A REDIRECT HERE, and that is deliberate rather than
   * unfinished. This console has no `/sign-in` route yet — `ls src/app` is the whole list —
   * and sending a pharmacist to a URL that 404s is worse than telling them what happened.
   * `src/components/sections.ts` records the same trap: a link that goes nowhere honest is
   * how a console stops being believed. When sign-in lands, this becomes a redirect.
   */
  const viewer = await currentStaff()

  return (
    <ConsoleShell title="Pharmacy" active="pharmacy">
      <div className="page-head">
        <div className="grow">
          <h1>Pharmacy</h1>
          <p>
            The live dispensing queue for the clinic&rsquo;s own licensed pharmacy. Carevelo
            routes the work item and records the status; the medicine is held, priced,
            dispensed and handed over by this clinic, under its own NDA licence.
          </p>
        </div>
      </div>

      {viewer === null ? (
        <Notice tone="warn" title="You are not signed in">
          The queue is behind the clinic&rsquo;s own authentication, and this session has
          ended. Sign in again to see it.
        </Notice>
      ) : viewer.password_change_required ? (
        /*
         * The API refuses every endpoint but `/v1/me`, the password change and sign-out
         * while this is set, so the queue would load as five failed lanes with no
         * explanation. Saying it once is the whole reason `MeResource` carries the flag.
         */
        <Notice tone="warn" title="Change your password first">
          Your account still has the password it was issued with. Until it is changed the API
          refuses everything else, so the queue cannot load.
        </Notice>
      ) : (
        <PharmacyQueueScreen viewer={viewer} paths={DISPENSING_PATHS} />
      )}
    </ConsoleShell>
  )
}
