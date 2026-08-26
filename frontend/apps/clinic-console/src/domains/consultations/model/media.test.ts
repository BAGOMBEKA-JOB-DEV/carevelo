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
  it('sends an unconfigured clinic to the honest fallback', () => {
    expect(mediaState(false)).toBe('unconfigured')
  })

  it('sends a configured clinic to the seam, which is not the same as working video', () => {
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
    for (const value of ['Clinician', 'admin', 'nurse', 'Dr Sarah Nakato', '', null, undefined, 7]) {
      expect(asParticipant(value)).toBeNull()
    }
  })
})
