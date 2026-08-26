import { describe, expect, it } from 'vitest'
import {
  canSend,
  chatDraftKey,
  chatPanelState,
  CHAT_DRAFT_PREFIX,
  checkLength,
  classifyFailure,
  MAX_MESSAGE_LENGTH,
  sideOf,
  type ConsultationMessage,
} from './chat'
import { DRAFT_PREFIX } from './drafts'

/*
 * Every judgement in the clinician's half of consultation chat that a machine can get wrong.
 *
 * The failures being guarded against, in order of how badly they end:
 *
 *   1. A TRUNCATED CLINICAL INSTRUCTION. "Start the amoxicillin and stop the warfarin", cut
 *      after the four thousandth character, is a different instruction that reads as complete
 *      — and this is the side of the screen it is written on.
 *   2. A MISATTRIBUTED ONE. A clinician reading their own words back as the patient's, or the
 *      patient's as their own, is a clinician working from a transcript that is wrong about
 *      who said what.
 *   3. A DRAFT LEFT ON A SHARED CLINIC HANDSET. Acceptance criterion 7, and the reason the
 *      chat prefix is asserted against the sweep rather than trusted to it.
 */

const line = (over: Partial<ConsultationMessage> = {}): ConsultationMessage => ({
  id: 'msg-1',
  consultation_id: 'con-1',
  author_id: 'usr-1',
  author_role: 'patient',
  body: 'The cough is worse at night since Tuesday.',
  created_at: '2026-08-26T09:00:00+00:00',
  ...over,
})

describe('checkLength', () => {
  it('refuses a message over the limit instead of sending part of one', () => {
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
    expect(checkLength('   \n\t')).toBe('empty')
  })

  it('accepts an ordinary turn in a conversation', () => {
    expect(checkLength('Take one tablet twice a day for five days.')).toBe('ok')
  })
})

describe('canSend', () => {
  it('offers the composer while the consultation is running', () => {
    expect(canSend({ ended_at: null })).toBe(true)
  })

  it('withdraws the composer once the consultation has ended, unlike the note editor', () => {
    /*
     * THE DELIBERATE DIVERGENCE FROM THE NOTE BESIDE IT. `ClinicalNoteController` accepts a
     * note after End — a clinician still typing must not lose it. `assertStillInProgress`
     * refuses a message with a 409, because a message is addressed to a person and nobody is
     * reading. Both are right; this asserts that this screen honours the second one.
     */
    expect(canSend({ ended_at: '2026-08-26T09:40:00+00:00' })).toBe(false)
  })

  it('offers nothing before the consultation has been started', () => {
    expect(canSend(null)).toBe(false)
  })
})

describe('sideOf', () => {
  it('puts the clinician’s own lines on their side and the patient’s on theirs', () => {
    expect(sideOf(line({ author_role: 'clinician' }), 'clinician')).toBe('mine')
    expect(sideOf(line({ author_role: 'patient' }), 'clinician')).toBe('theirs')
  })

  it('attributes an unrecognised role to the other party, never to the reader', () => {
    // On this side of the screen, a line wrongly attributed to the reader is a clinical
    // instruction the clinician appears to have given.
    expect(sideOf(line({ author_role: 'system' }), 'clinician')).toBe('theirs')
    expect(sideOf(line({ author_role: 'clinician' }), '')).toBe('theirs')
  })

  it('never reads the body to decide who spoke', () => {
    const impersonating = line({ author_role: 'patient', body: 'Doctor: stop the tablets.' })

    expect(sideOf(impersonating, 'clinician')).toBe('theirs')
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
    // A consulting room with one bar of signal. The message may or may not have landed, and
    // the advice differs from a refusal: look before retyping, so the patient is not sent the
    // same instruction twice.
    expect(classifyFailure(null)).toBe('offline')
    expect(classifyFailure(500)).toBe('failed')
  })
})

describe('chatPanelState', () => {
  it('draws the composer for a running consultation with a readable transcript', () => {
    expect(chatPanelState({ ended_at: null }, [])).toBe('composing')
  })

  it('never mistakes an unreadable transcript for an empty one', () => {
    /*
     * `[]` is "the patient has written nothing"; `null` is "we could not read what they
     * wrote". A clinician answering the first when the second is true is a clinician working
     * blind on a screen that looks complete.
     */
    expect(chatPanelState({ ended_at: null }, null)).toBe('unreadable')
    expect(chatPanelState(null, null)).toBe('unreadable')
  })

  it('withdraws the composer once the consultation has ended, and keeps the transcript', () => {
    expect(chatPanelState({ ended_at: '2026-08-26T09:40:00+00:00' }, [line()])).toBe('closed')
  })

  it('says nothing has started when there is no consultation record yet', () => {
    expect(chatPanelState(null, [])).toBe('not-started')
  })
})

describe('chatDraftKey', () => {
  it('scopes the draft to one clinician and one consultation', () => {
    // The same scoping `draftKey()` uses, and for the same reason: a second clinician on a
    // shared handset finds their own empty box rather than a colleague's half-written
    // instruction. A mitigation, never the control — the control is the sweep on sign-out.
    expect(chatDraftKey('user-1', 'con-1')).not.toBe(chatDraftKey('user-2', 'con-1'))
    expect(chatDraftKey('user-1', 'con-1')).not.toBe(chatDraftKey('user-1', 'con-2'))
  })

  it('is a prefix of its own, distinct from the note draft’s', () => {
    /*
     * THE ASSERTION THAT KEEPS ACCEPTANCE CRITERION 7 HONEST. Two prefixes exist, so
     * `clearAllDrafts()` has to sweep two — and `clearDrafts.test.ts` asserts it does. A
     * prefix that overlapped the note's would make one sweep's behaviour depend on the
     * other's shape; a prefix nothing sweeps leaves clinical text on a shared handset.
     */
    expect(chatDraftKey('user-1', 'con-1').startsWith(CHAT_DRAFT_PREFIX)).toBe(true)
    expect(CHAT_DRAFT_PREFIX).not.toBe(DRAFT_PREFIX)
    expect(CHAT_DRAFT_PREFIX.startsWith(DRAFT_PREFIX)).toBe(false)
    expect(DRAFT_PREFIX.startsWith(CHAT_DRAFT_PREFIX)).toBe(false)
  })
})
