'use client'

import { DRAFT_PREFIX } from '../model/drafts'

/**
 * Remove every note draft this browser is holding.
 *
 * ====================================================================================
 * THIS IS ACCEPTANCE CRITERION 7, AND IT IS WIRED UP NOW
 * ====================================================================================
 *
 * "No clinical data persists in client storage beyond the ACTIVE note draft" — which means the
 * drafts have to go on sign-out, and this is the function that does it. It is called from the
 * identity domain's sign-out path, which is where `model/drafts.ts` always said the call would
 * live: `domains/identity/components/SignOutSubmit.tsx`, rendered by `SignOutScreen`.
 *
 * IT WAS EXPORTED AND UNCALLED FOR A WHILE, AND THAT IS WORTH RECORDING RATHER THAN TIDYING
 * AWAY. The function existed, the domain's public surface exported it, `model/drafts.ts`
 * described the contract in detail — and nothing in the product ever invoked it, because the
 * console had no sign-out control when this was written. Every part of the design was in place
 * except the one line that made it do anything, which is the shape of defect this codebase
 * keeps finding: the command nobody scheduled, the column nobody wrote, the endpoint nobody
 * routed. The criterion was not partly met. It was not met at all.
 *
 * IT WAS ALSO CALLED SOMETHING ELSE. `model/drafts.ts` specified `clearAllDrafts()` and this
 * file defined `clearAllNoteDrafts()`, so the identifier the contract named appeared nowhere
 * in the codebase — which is exactly why a reader looking for the wiring concluded there was
 * none. The specification's name won: there is one function, under the name the document that
 * governs it uses, and a grep for it now finds the implementation, the export and the call.
 *
 * WHY IT SWEEPS BY PREFIX RATHER THAN BY KEY. Sign-out does not know which consultations this
 * browser has drafts for; asking it to would mean keeping an index, which is one more thing to
 * get out of step. Every key this product writes starts with `carevelo.note-draft.v1.` and
 * nothing else does.
 *
 * WHY IT IS 'use client'. `localStorage` exists only in a browser. Signing out happens through
 * a Server Action, and a server cannot reach into a browser's storage — which is precisely why
 * the criterion needs a function like this rather than a header. See `SignOutSubmit.tsx` for
 * how the two are made to happen on the same press, and for what happens when the bundle has
 * not arrived.
 *
 * ====================================================================================
 * THE try/catch IS NOT DEFENSIVE PROGRAMMING. IT IS THE PRODUCT DECISION.
 * ====================================================================================
 *
 * `localStorage` does not return null when it is unavailable — it THROWS. Safari in private
 * browsing throws on access, and so does a browser under a managed-device policy that blocks
 * site data, which is not an exotic configuration on a clinic's own laptops. Even reading
 * `window.localStorage.length` is enough to raise it.
 *
 * So the question this file has to answer is: if the drafts cannot be cleared, should the
 * sign-out fail? No. An exception thrown out of the click handler would leave a clinician
 * pressing "Sign out" on a shared terminal and staying signed in — and a signed-in console is
 * a view of the clinic's whole patient registry, standing in a room the public walks through.
 * That is a strictly worse outcome than a draft surviving, and in the very case where the
 * throw happens there is usually nothing stored to survive: a browser that refuses storage
 * refused it to the editor too.
 *
 * The catch is therefore SILENT and deliberately so. Nothing is logged: a log line written on
 * this path would be written on a clinician's own machine at the moment they walk away from
 * it, and there is no action anybody could take on it.
 */
export function clearAllDrafts(): void {
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
    // notes left on a shared handset. clearDrafts.test.ts holds a case with enough keys that
    // the interleaved version fails it.
    for (const key of doomed) {
      window.localStorage.removeItem(key)
    }
  } catch {
    // Storage unavailable — see the docblock. Throwing out of a sign-out path would leave
    // somebody signed in, which is the worse of the two failures by a distance.
  }
}
