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
  it('sends an unconfigured clinic to the honest fallback', () => {
    expect(mediaState(false)).toBe('unconfigured')
  })

  it('sends a configured clinic to the seam, which is not the same as working video', () => {
    // `no-client` is a truthful dead end: a session was brokered and this build carries no
    // client able to open it. It is NOT `ready`, and there is deliberately no such state.
    expect(mediaState(true)).toBe('no-client')
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
