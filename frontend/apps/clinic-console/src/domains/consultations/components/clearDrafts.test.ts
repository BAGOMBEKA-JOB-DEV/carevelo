import { afterEach, describe, expect, it } from 'vitest'
import { clearAllDrafts } from './clearDrafts'
import { chatDraftKey, CHAT_DRAFT_PREFIX } from '../model/chat'
import { DRAFT_PREFIX, draftKey } from '../model/drafts'

/*
 * The one function that satisfies acceptance criterion 7.
 *
 * "No clinical data persists in client storage beyond the active note draft." The whole of
 * that criterion, on this surface, is this sweep running on sign-out — so what is asserted
 * below is not the sweep's convenience but its completeness, and the two ways it has
 * historically been got wrong:
 *
 *   1. LEAVING HALF OF THEM. `localStorage` is indexed, and removing a key while walking the
 *      indices shifts every later key down by one under the loop. With four drafts that
 *      leaves two behind. Half a clinician's notes on a shared clinic laptop is the exact
 *      exposure the criterion is written against, and it is invisible in a diff and in
 *      manual testing with a single draft — so the case below uses six.
 *   2. THROWING. `localStorage` does not return null when it is blocked, it throws — Safari
 *      in private browsing, and a managed-device policy that blocks site data, which is not
 *      exotic on a clinic's own laptops. An exception out of this function leaves a clinician
 *      pressing "Sign out" on a shared terminal and staying signed in, which is worse than
 *      the draft it was trying to protect.
 *
 *   3. MISSING A WHOLE KIND OF DRAFT. This is the new one, and it is the quietest of the
 *      three. The sweep matched one prefix while the domain wrote two: the consultation room
 *      now has a chat composer, and a half-written message to a patient is clinical text in
 *      client storage exactly as a half-written note is. A sweep blind to it runs, reports
 *      success, and leaves that message on a shared clinic handset for whoever signs in next.
 *      Nothing in a type, a diff or a manual test shows it — only a test that names both
 *      prefixes, which is what the case below is.
 *
 * AND ONE THING IT MUST NOT DO: reach past its own prefixes. Sign-out is a blunt instrument
 * and this function runs inside it, so a sweep that took the theme preference or a session
 * hint with it would be a bug nobody could attribute.
 */

afterEach(() => {
  window.localStorage.clear()
})

describe('clearAllDrafts', () => {
  it('removes every draft this browser is holding, however many there are', () => {
    /*
     * SIX, ACROSS TWO CONSULTATIONS, WHICH IS THE POINT OF THE NUMBER. An implementation
     * that removed keys while iterating the index passes with one and fails here — the
     * indices shift under the loop and the survivors are exactly the ones nobody notices.
     * The keys are built with `draftKey()` rather than typed out, so a change to the key
     * format cannot leave this test passing against a shape the product no longer writes.
     */
    const keys = [
      draftKey('user-1', 'consult-a', 'subjective'),
      draftKey('user-1', 'consult-a', 'objective'),
      draftKey('user-1', 'consult-a', 'assessment'),
      draftKey('user-1', 'consult-a', 'plan'),
      draftKey('user-1', 'consult-b', 'subjective'),
      draftKey('user-2', 'consult-b', 'plan'),
    ]

    for (const key of keys) {
      window.localStorage.setItem(key, JSON.stringify({ body: 'clinical text' }))
    }

    clearAllDrafts()

    expect(keys.filter((key) => window.localStorage.getItem(key) !== null)).toEqual([])
  })

  it('clears drafts belonging to a user who is not the one signing out', () => {
    /*
     * THE MOTIVATING SCENARIO, STATED AS A TEST. The key is scoped per signed-in user, which
     * is why nobody noticed the missing call: a second clinician on a shared laptop finds
     * their own empty editor rather than a colleague's text. That is a mitigation and it was
     * never the control — the first clinician's note is still sitting in storage, readable by
     * anything with script access to that origin. Sign-out takes ALL of them, not the
     * departing user's, and that is deliberate: the browser is the thing being handed over.
     */
    const mine = draftKey('user-1', 'consult-a', 'plan')
    const theirs = draftKey('user-2', 'consult-a', 'plan')

    window.localStorage.setItem(mine, 'x')
    window.localStorage.setItem(theirs, 'y')

    clearAllDrafts()

    expect(window.localStorage.getItem(mine)).toBeNull()
    expect(window.localStorage.getItem(theirs)).toBeNull()
  })

  it('takes the chat draft as well as the note draft', () => {
    /*
     * ACCEPTANCE CRITERION 7 AGAINST THE SURFACE THAT WAS ADDED AFTER IT WAS WRITTEN. A
     * clinician's half-typed message to a patient is clinical text in client storage, and the
     * criterion does not distinguish it from a note. Both keys are built by the functions the
     * product uses, so a change to either format cannot leave this passing against a shape
     * nothing writes.
     */
    const note = draftKey('user-1', 'consult-a', 'plan')
    const chat = chatDraftKey('user-1', 'consult-a')

    window.localStorage.setItem(note, 'clinical text')
    window.localStorage.setItem(chat, 'Take one tablet twice a day and stop the other one.')

    clearAllDrafts()

    expect(window.localStorage.getItem(note)).toBeNull()
    expect(window.localStorage.getItem(chat)).toBeNull()
  })

  it('sweeps every prefix the domain writes clinical text under, not just the first', () => {
    /*
     * THE GUARD AGAINST THE THIRD PREFIX. Written as a loop over the two names rather than as
     * two assertions, so that adding a kind of draft and forgetting the sweep fails HERE —
     * with the prefix that was missed printed in the failure — rather than on a handset.
     */
    for (const prefix of [DRAFT_PREFIX, CHAT_DRAFT_PREFIX]) {
      const key = `${prefix}user-1.consult-a.something`

      window.localStorage.setItem(key, 'clinical text')

      clearAllDrafts()

      expect(window.localStorage.getItem(key), `${prefix} survived the sweep`).toBeNull()
    }
  })

  it('leaves anything that is not a draft alone', () => {
    // Sign-out is blunt and this runs inside it. A sweep that took the theme preference with
    // it would be a bug nobody could attribute to this function.
    window.localStorage.setItem('carevelo.theme', 'dark')
    window.localStorage.setItem('unrelated', 'keep me')
    window.localStorage.setItem(draftKey('user-1', 'consult-a', 'plan'), 'go')
    window.localStorage.setItem(chatDraftKey('user-1', 'consult-a'), 'go')

    clearAllDrafts()

    expect(window.localStorage.getItem('carevelo.theme')).toBe('dark')
    expect(window.localStorage.getItem('unrelated')).toBe('keep me')
  })

  it('does nothing at all when there is nothing to clear', () => {
    expect(() => clearAllDrafts()).not.toThrow()
    expect(window.localStorage.length).toBe(0)
  })

  it('does not throw when the browser refuses storage', () => {
    /*
     * SAFARI IN PRIVATE BROWSING, AND A MANAGED DEVICE WITH SITE DATA BLOCKED. Both THROW on
     * access rather than returning null, and reading `.length` is enough to raise it — which
     * is why the try/catch has to wrap the loop and not just the removals.
     *
     * The property is redefined rather than spied on: `localStorage` is an accessor on the
     * jsdom `Window`, and this is the smallest thing that reproduces "touching it explodes".
     * Restored in the same test rather than in `afterEach`, so a failure inside the
     * expectation cannot leave every later test in this file running against a window whose
     * storage throws.
     */
    const original = Object.getOwnPropertyDescriptor(window, 'localStorage')

    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new Error('SecurityError: The operation is insecure.')
      },
    })

    try {
      expect(() => clearAllDrafts()).not.toThrow()
    } finally {
      if (original === undefined) {
        Reflect.deleteProperty(window, 'localStorage')
      } else {
        Object.defineProperty(window, 'localStorage', original)
      }
    }
  })

  it('sweeps the prefix the rest of the domain writes, not a copy of it', () => {
    // A second spelling of the prefix in this file would be a test that goes on passing
    // after the product's own keys move — the failure mode being a previous clinician's
    // notes surviving a sign-out that reported success.
    expect(draftKey('user-1', 'consult-a', 'plan').startsWith(DRAFT_PREFIX)).toBe(true)
  })
})
