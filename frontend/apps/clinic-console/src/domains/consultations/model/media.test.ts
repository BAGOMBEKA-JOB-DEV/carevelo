import { describe, expect, it } from 'vitest'
import { asParticipant, CONFIGURED, isMediaConfigured, mediaState, PARTICIPANT_LABELS } from './media'

/*
 * THE ONE TEST HERE THAT IS WORTH MORE THAN THE CODE IT COVERS.
 *
 * `isMediaConfigured` is six characters of logic and it is the single line between a
 * clinician being told to hold the consultation by telephone and a clinician staring at an
 * empty pane waiting for a picture that is not coming. The value that springs the trap — the
 * STRING 'false' — is what every unconfigured clinic sends today, which is all of them.
 * It is not an edge case. It is the default path.
 *
 * The comparison lived inline in api/room.ts, a module that imports next/headers and so
 * cannot be loaded by this runner. Three comments described the trap and nothing asserted it.
 */

describe('isMediaConfigured', () => {
  it("treats the string 'false' as not configured, which is the whole point", () => {
    expect(isMediaConfigured('false')).toBe(false)
    expect(Boolean('false')).toBe(true)
  })

  it("treats the string 'true' as configured", () => {
    expect(isMediaConfigured('true')).toBe(true)
    expect(isMediaConfigured(CONFIGURED)).toBe(true)
  })

  it('fails closed on every shape that is not exactly the contracted string', () => {
    /*
     * FAILING CLOSED MEANS TELLING THE CLINICIAN TO CARRY ON WITHOUT A PICTURE. The boolean
     * `true` is in this list deliberately: it can only arrive if somebody changed
     * `VideoProvider::credentialsFor`'s `array<string, string>` contract, and surfacing that
     * on a developer's screen beats discovering it in a consulting room.
     */
    for (const value of ['TRUE', 'True', '1', 'yes', '', ' true', 'true ', true, 1, null, undefined, {}]) {
      expect(isMediaConfigured(value)).toBe(false)
    }
  })
})

describe('mediaState', () => {
  const URL = 'wss://media.example.ug'
  const TOKEN = 'header.claims.signature'

  it('sends an unconfigured clinic to the honest fallback, credentials or not', () => {
    /*
     * `configured` OUTRANKS EVERYTHING, and the second case is the one worth asserting: if a
     * url and a token somehow arrive alongside `configured: false`, the answer is still to
     * hold the consultation the way the clinic already does. The flag is the platform's own
     * statement about whether this clinic has a media server, and a console that opened a
     * pane because two other fields looked promising would be second-guessing it.
     */
    expect(mediaState(false, null, null)).toEqual({ kind: 'unconfigured' })
    expect(mediaState(false, URL, TOKEN)).toEqual({ kind: 'unconfigured' })
  })

  it('opens the room when a configured clinic sent both halves', () => {
    expect(mediaState(true, URL, TOKEN)).toEqual({ kind: 'ready', url: URL, token: TOKEN })
  })

  it('refuses to open a room on half a credential', () => {
    /*
     * THIS IS THE DEPLOY CASE AND IT IS THE REASON `no-client` OUTLIVED THE SDK.
     *
     * An entry is remembered in a cookie for ninety minutes, and the build before this one
     * stored neither of these fields. So for ninety minutes after a deploy, clinicians in
     * live consultations arrive holding `configured: true` and nothing to connect with.
     * `ready` here would hand them a client pointed at `undefined`, which does not throw and
     * does not log — it sits on "connecting" while a patient waits.
     *
     * A url with no token and a token with no url are in the list for the same reason: one
     * cannot authenticate and the other has nowhere to go, so neither is half-open.
     */
    expect(mediaState(true, null, null)).toEqual({ kind: 'no-client' })
    expect(mediaState(true, URL, null)).toEqual({ kind: 'no-client' })
    expect(mediaState(true, null, TOKEN)).toEqual({ kind: 'no-client' })
  })
})

describe('asParticipant', () => {
  it('accepts exactly the two labels the provider is ever told', () => {
    expect(asParticipant('patient')).toBe('patient')
    expect(asParticipant('clinician')).toBe('clinician')
    expect(PARTICIPANT_LABELS).toEqual(['patient', 'clinician'])
  })

  it('refuses anything else rather than defaulting to a side', () => {
    for (const value of ['Clinician', 'admin', 'nurse', 'Dr Sarah Nakato', '', null, undefined, 7]) {
      expect(asParticipant(value)).toBeNull()
    }
  })
})
