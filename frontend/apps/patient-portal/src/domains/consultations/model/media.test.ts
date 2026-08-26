import { describe, expect, it } from 'vitest'
import { asParticipant, CONFIGURED, isMediaConfigured, mediaState, PARTICIPANT_LABELS } from './media'

/*
 * THE ONE TEST IN THIS DOMAIN THAT IS WORTH MORE THAN THE CODE IT COVERS.
 *
 * `isMediaConfigured` is six characters of logic and it is the single line between a patient
 * being shown their clinic's telephone number and a patient being shown an empty room with no
 * way out. The value that springs the trap — the STRING 'false' — is what every unconfigured
 * clinic sends today, which is all of them, so getting it wrong is not an edge case. It is
 * the default path.
 *
 * The comparison lived inline in api/room.ts, in a module that imports next/headers and so
 * cannot be loaded by this runner at all. Three separate comments described the trap and
 * nothing asserted it. That is the same shape of defect this codebase keeps turning up: fully
 * described, fully exported, never once executed.
 */

describe('isMediaConfigured', () => {
  it("treats the string 'false' as not configured, which is the whole point", () => {
    /*
     * `Boolean('false')` is true. This one assertion is the difference between the honest
     * fallback and a dead room, on every tenant that has not deployed a media server.
     */
    expect(isMediaConfigured('false')).toBe(false)
    expect(Boolean('false')).toBe(true)
  })

  it("treats the string 'true' as configured", () => {
    expect(isMediaConfigured('true')).toBe(true)
    expect(isMediaConfigured(CONFIGURED)).toBe(true)
  })

  it('fails closed on every shape that is not exactly the contracted string', () => {
    /*
     * FAILING CLOSED MEANS SHOWING THE TELEPHONE NUMBER. Each of these resolves to "no media
     * server", and the boolean `true` is in the list deliberately: it can only arrive if
     * somebody changed `VideoProvider::credentialsFor`'s `array<string, string>` contract, and
     * surfacing that on a developer's screen beats discovering it on a patient's.
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
     * `configured` OUTRANKS EVERYTHING, and the second case is the one worth asserting: if
     * a url and a token somehow arrive alongside `configured: false`, the answer is still
     * the telephone number. The flag is the platform's own statement about whether this
     * clinic has a media server, and a client that opened a room because two other fields
     * looked promising would be second-guessing it.
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
     * stored neither of these fields. So for ninety minutes after a deploy, real patients
     * arrive holding `configured: true` and nothing to connect with. `ready` here would
     * hand them a client pointed at `undefined`, which does not throw and does not log —
     * it sits on "connecting" until they give up.
     *
     * A url with no token and a token with no url are in the list for the same reason: one
     * cannot authenticate and the other has nowhere to go, so neither is half-open. Both
     * are closed.
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
    // A default here would mislabel which side of a consultation somebody is on. The screens
    // omit the line instead.
    for (const value of ['Patient', 'admin', 'nurse', 'Aisha Nambooze', '', null, undefined, 7]) {
      expect(asParticipant(value)).toBeNull()
    }
  })
})
