'use server'

import { attempt } from './gateway'
import { listAppointments } from './appointments'

/**
 * The one thing a browser is allowed to ask this domain, and it is not for data.
 *
 * A DAY VIEW IS CORRECT AT THE MOMENT IT IS DRAWN AND NEVER AGAIN. The front desk books into
 * the same day while a clinician is looking at it; a patient pays and a hold becomes a
 * confirmation; a colleague cancels. A clinician staring at a page from four minutes ago has
 * no way to know, and the failure is silent — the screen looks fine.
 *
 * SO SOMETHING HAS TO NOTICE, AND WHAT IT RETURNS IS A SIGNATURE RATHER THAN THE DAY. That is
 * @carevelo/realtime's central rule applied to a poll: "a frame is a hint to re-fetch, it is
 * never the thing itself". The browser learns only THAT something moved; the server component
 * re-renders to say what it now is, under the same authorisation as the first render. Three
 * things follow, and each is worth the round trip:
 *
 *   - the API stays the single source of truth, so a missed tick costs freshness and never
 *     correctness;
 *   - the re-render runs the whole authorisation again, under the policy and row-level
 *     security, rather than trusting a value the browser already held;
 *   - nothing clinical is ever handed to a browser except by a server render that was going
 *     to hand it over anyway. The string below is identifiers and states — exactly what a
 *     broadcast frame is permitted to carry, and nothing more.
 *
 * `day` AND `clinicianId` COME FROM THE CLIENT, and that is fine: they are arguments to an
 * authorised read. `GET /v1/appointments` narrows to this clinic under row-level security, so
 * the worst a forged argument achieves is a signature for a day of this clinic's own
 * schedule, which the caller is already looking at.
 */
export async function dayDigest(day: string, clinicianId: string | null): Promise<string> {
  const page = await attempt(
    listAppointments({
      from: day,
      to: day,
      clinicianId: clinicianId ?? undefined,
    }),
  )

  if (!page.ok) {
    // A failed poll must not look like an empty day. Returning a constant means the client
    // sees "nothing changed" and leaves the page it has, which is the correct behaviour for a
    // check that could not run — losing freshness, never correctness.
    return 'unknown'
  }

  return page.value.data.map((row) => `${row.id}:${row.status}`).join(',')
}
