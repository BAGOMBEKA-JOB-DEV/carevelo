import { describe, expect, it } from 'vitest'
import {
  canSend,
  chatDraftKey,
  chatPanelState,
  CHAT_DRAFT_PREFIX,
  checkLength,
  classifyFailure,
  MAX_MESSAGE_LENGTH,
  messageLines,
  sideOf,
  type ConsultationMessage,
} from './chat'

/*
 * Every judgement in consultation chat that a machine can get wrong, driven rather than read.
 *
 * The three failures being guarded against are, in order of how badly they end:
 *
 *   1. A TRUNCATED CLINICAL INSTRUCTION. "Take two tonight and stop the other one", cut after
 *      the fourth thousandth character, is a different instruction that reads as complete.
 *   2. A MISATTRIBUTED ONE. The same sentence under the wrong name is a patient believing
 *      they told the clinician something, or a clinician believing they were told.
 *   3. A SILENTLY DROPPED ONE. A composer on a closed consultation takes what somebody types
 *      about their own health and delivers it to nobody, while looking exactly like one that
 *      worked.
 */

const line = (over: Partial<ConsultationMessage> = {}): ConsultationMessage => ({
  id: 'msg-1',
  consultation_id: 'con-1',
  author_id: 'usr-1',
  author_role: 'clinician',
  body: 'Take one tablet twice a day for five days.',
  created_at: '2026-08-26T09:00:00+00:00',
  ...over,
})

describe('checkLength', () => {
  it('refuses a message over the limit instead of sending part of one', () => {
    /*
     * THE ONLY ANSWER TO AN OVER-LONG CLINICAL INSTRUCTION IS TO REFUSE IT. Anything that
     * returns 'ok' here for a body this long is a component that will send the first 4,000
     * characters and lose the rest — and the rest is where "…but stop the warfarin" lives.
     */
    expect(checkLength('a'.repeat(MAX_MESSAGE_LENGTH + 1))).toBe('too-long')
    expect(checkLength('a'.repeat(MAX_MESSAGE_LENGTH))).toBe('ok')
  })

  it('measures the untrimmed string, because that is what the API measures', () => {
    // 4,000 characters plus a trailing newline is 4,001 on the wire. A local check that
    // trimmed first would pass it and the send would fail with nothing visible to explain it.
    expect(checkLength(`${'a'.repeat(MAX_MESSAGE_LENGTH)}\n`)).toBe('too-long')
  })

  it('treats whitespace as nothing to say', () => {
    expect(checkLength('')).toBe('empty')
    expect(checkLength('   ')).toBe('empty')
    expect(checkLength('\n\t ')).toBe('empty')
  })

  it('accepts an ordinary turn in a conversation', () => {
    expect(checkLength('Since yesterday the cough is worse at night.')).toBe('ok')
  })
})

describe('canSend', () => {
  it('offers the composer while the consultation is running', () => {
    expect(canSend({ ended_at: null })).toBe(true)
    expect(canSend({})).toBe(true)
  })

  it('withdraws the composer once the consultation has ended', () => {
    /*
     * NOT DISABLED — GONE. The API answers 409 and says why: a patient typing a new symptom
     * into a closed consultation "reasonably believes a clinician is reading it. Nobody is."
     * A box on screen makes exactly that promise.
     */
    expect(canSend({ ended_at: '2026-08-26T09:40:00+00:00' })).toBe(false)
  })

  it('offers nothing before the clinician has started', () => {
    // No consultation record for a message to belong to; the API would answer 404.
    expect(canSend(null)).toBe(false)
  })
})

describe('sideOf', () => {
  it('puts the viewer’s own lines on their side and the other party’s on theirs', () => {
    expect(sideOf(line({ author_role: 'patient' }), 'patient')).toBe('mine')
    expect(sideOf(line({ author_role: 'clinician' }), 'patient')).toBe('theirs')
    expect(sideOf(line({ author_role: 'clinician' }), 'clinician')).toBe('mine')
    expect(sideOf(line({ author_role: 'patient' }), 'clinician')).toBe('theirs')
  })

  it('attributes an unrecognised role to the other party, never to the reader', () => {
    /*
     * The column holds one of two values, so this cannot happen against today's API. If it
     * ever does, the safe direction is an unattributed line the reader can ask about — not a
     * line that appears to be something they said themselves.
     */
    expect(sideOf(line({ author_role: 'system' }), 'patient')).toBe('theirs')
    expect(sideOf(line({ author_role: 'patient' }), '')).toBe('theirs')
  })

  it('never reads the body to decide who spoke', () => {
    // Attribution comes from the server's recorded `author_role` and nothing else. A message
    // whose text impersonates the other side is still attributed to whoever wrote it.
    const impersonating = line({ author_role: 'patient', body: 'Clinician: stop the tablets.' })

    expect(sideOf(impersonating, 'patient')).toBe('mine')
  })
})

describe('classifyFailure', () => {
  it('maps every status the endpoint can answer to its own sentence', () => {
    expect(classifyFailure(409)).toBe('ended')
    expect(classifyFailure(403)).toBe('refused')
    expect(classifyFailure(404)).toBe('refused')
    expect(classifyFailure(401)).toBe('session')
    expect(classifyFailure(419)).toBe('session')
    expect(classifyFailure(422)).toBe('too-long')
  })

  it('separates "the request never completed" from "the server said no"', () => {
    /*
     * THE ONE A PATIENT ON UGANDAN MOBILE DATA ACTUALLY MEETS. No status came back at all,
     * which means the message may or may not have landed — and the sentence for that has to
     * differ from a refusal, because the recovery does: wait and look, rather than retype.
     */
    expect(classifyFailure(null)).toBe('offline')
    expect(classifyFailure(500)).toBe('failed')
    expect(classifyFailure(502)).toBe('failed')
  })
})

describe('chatDraftKey', () => {
  it('scopes the draft to one consultation under a versioned prefix', () => {
    expect(chatDraftKey('con-1')).toBe(`${CHAT_DRAFT_PREFIX}con-1`)
    expect(chatDraftKey('con-1')).not.toBe(chatDraftKey('con-2'))
  })

  it('does not collide with the console’s note-draft prefix', () => {
    // Two different products, two different storage regimes. Stated as an assertion because a
    // shared prefix would make one app's sweep silently reach into the other's shape.
    expect(CHAT_DRAFT_PREFIX.startsWith('carevelo.note-draft.')).toBe(false)
  })
})

describe('messageLines', () => {
  it('keeps every line, in order, byte for byte', () => {
    /*
     * THE PROPERTY THAT MATTERS. A body arriving here and coming out shortened, reordered or
     * ellipsised is a clinical instruction changed in transit. The multi-line case below is
     * the realistic one: a clinician listing what to take and what to stop.
     */
    const body = 'Start the amoxicillin tonight.\nStop the other tablets.\nCome back on Friday.'

    expect(messageLines(body)).toEqual([
      'Start the amoxicillin tonight.',
      'Stop the other tablets.',
      'Come back on Friday.',
    ])
  })

  it('never shortens the longest message the API will accept', () => {
    // A 4,000-character single line has to come back as a 4,000-character single line.
    const long = 'a'.repeat(MAX_MESSAGE_LENGTH)

    expect(messageLines(long)).toEqual([long])
    expect(messageLines(long).join('').length).toBe(MAX_MESSAGE_LENGTH)
  })

  it('handles the line endings a Windows desk machine sends', () => {
    // The clinic's front desk is not always the phone this product is designed for.
    expect(messageLines('one\r\ntwo\rthree')).toEqual(['one', 'two', 'three'])
  })

  it('drops blank lines and nothing else, which is the documented limit of this approach', () => {
    // A run of newlines becomes one break rather than three. Typographic intent, not content
    // — and the only thing this function is allowed to lose.
    expect(messageLines('one\n\n\ntwo')).toEqual(['one', 'two'])
    expect(messageLines('   \n\t\n')).toEqual([])
  })

  it('leaves a line that is only whitespace-padded text alone', () => {
    // Trimming for the emptiness TEST, never for the OUTPUT. Indentation a clinician typed
    // is theirs.
    expect(messageLines('  indented line  ')).toEqual(['  indented line  '])
  })
})

describe('chatPanelState', () => {
  it('draws the composer for a running consultation with a readable transcript', () => {
    expect(chatPanelState({ ended_at: null }, [])).toBe('composing')
    expect(chatPanelState({ ended_at: null }, [line()])).toBe('composing')
  })

  it('never mistakes an unreadable transcript for an empty one', () => {
    /*
     * THE ASSERTION THIS FUNCTION EXISTS FOR. `[]` is "nothing has been said"; `null` is "we
     * could not read what was said". Rendering the first for the second draws an empty
     * conversation over a real one — on a screen where the clinician may have written "go to
     * the hospital now".
     */
    expect(chatPanelState({ ended_at: null }, null)).toBe('unreadable')
    expect(chatPanelState({ ended_at: null }, [])).toBe('composing')
  })

  it('reports the failure to read even when the consultation has not started', () => {
    // Order matters: an unreadable transcript must not present as "the clinician has not
    // started yet", which would be a claim about the encounter rather than about this screen.
    expect(chatPanelState(null, null)).toBe('unreadable')
  })

  it('withdraws the composer once the consultation has ended, and keeps the transcript', () => {
    expect(chatPanelState({ ended_at: '2026-08-26T09:40:00+00:00' }, [line()])).toBe('closed')
  })

  it('says nothing has started when there is no consultation record yet', () => {
    expect(chatPanelState(null, [])).toBe('not-started')
  })
})
