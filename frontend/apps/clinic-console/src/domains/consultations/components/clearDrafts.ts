'use client'

import { DRAFT_PREFIX } from '../model/drafts'

/**
 * Remove every note draft this browser is holding.
 *
 * ====================================================================================
 * THIS IS ACCEPTANCE CRITERION 7, AND IT IS NOT WIRED UP YET
 * ====================================================================================
 *
 * "No clinical data persists in client storage beyond the ACTIVE note draft" — which means the
 * drafts have to go on sign-out, and this is the function that does it. Nothing calls it,
 * because the console's identity domain is an empty placeholder this change does not own and a
 * sign-out control does not exist on this surface yet.
 *
 * It is exported from the domain's public surface anyway, and deliberately: when sign-out is
 * built there is then exactly one function to call, and no temptation to reimplement the key
 * format in the identity domain — where a mismatched prefix would fail silently and leave a
 * previous clinician's notes on a shared clinic handset.
 *
 * WHY IT SWEEPS BY PREFIX RATHER THAN BY KEY. Sign-out does not know which consultations this
 * browser has drafts for; asking it to would mean keeping an index, which is one more thing to
 * get out of step. Every key this product writes starts with `carevelo.note-draft.v1.` and
 * nothing else does.
 *
 * WHY IT IS 'use client'. `localStorage` exists only in a browser. A sign-out that happens
 * through a server action has to call this from a client component in the same click — the
 * server cannot reach into the browser's storage, which is precisely why the criterion needs
 * a function like this rather than a header.
 */
export function clearAllNoteDrafts(): void {
  try {
    const doomed: string[] = []

    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)

      if (key !== null && key.startsWith(DRAFT_PREFIX)) {
        doomed.push(key)
      }
    }

    // Collected first, removed second. Removing while iterating shifts the indices underneath
    // the loop and silently leaves half of them behind — which, here, is half a clinician's
    // notes left on a shared handset.
    for (const key of doomed) {
      window.localStorage.removeItem(key)
    }
  } catch {
    // Storage unavailable means there is nothing stored to clear. Throwing out of a sign-out
    // path would leave somebody signed in.
  }
}
