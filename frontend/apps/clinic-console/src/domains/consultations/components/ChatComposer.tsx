'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field, Notice, Stack, Textarea } from '@carevelo/ui'
import { sendConsultationMessage } from '../api/actions'
import { chatDraftKey, checkLength, type SendFailure } from '../model/chat'

/**
 * The box a clinician types into — the third `'use client'` module in this domain, after the
 * note editor and the freshness poller.
 *
 * ====================================================================================
 * THE DIRECTIVE IS EARNED BY THE SAME REQUIREMENT THE NOTE EDITOR EARNS IT BY
 * ====================================================================================
 *
 * docs/30-architecture/frontend-nextjs.md:132 — a draft must survive a dropped connection.
 * `model/drafts.ts` puts it plainly: "LOCAL STORAGE IS THE GUARANTEE. The network is not."
 * This room also re-renders on its own every fifteen seconds, so a clinician half-way through
 * typing an instruction when a poll lands must not lose the sentence. Persisting on a
 * keystroke needs a keystroke handler; reading it back needs `localStorage`; neither exists
 * on a server.
 *
 * AND `'use client'` DRAGS ITS WHOLE IMPORT GRAPH INTO THE BROWSER BUNDLE — the reason
 * `SignOutSubmit` had to move into this domain in the first place. So the imports above are
 * four UI primitives, the router, one server action and a pure model module. `../api/messages`
 * is NOT imported here: it pulls `next/headers` through the gateway, and it is reached only
 * through the action.
 *
 * ====================================================================================
 * THE ORDER OF OPERATIONS, WHICH IS THE WHOLE DESIGN
 * ====================================================================================
 *
 *   1. The clinician types. The text goes to `localStorage` SYNCHRONOUSLY, in the same tick.
 *   2. They press send. The box KEEPS THE TEXT and the button locks. In a consulting room
 *      with one bar of signal this request can take many seconds, and the one thing that must
 *      not happen is the words disappearing while it is in flight.
 *   3. The send succeeds. Only THEN are the box and the stored draft cleared, and
 *      `router.refresh()` re-renders the room so the message appears in the transcript ABOVE,
 *      from the server. It is never echoed out of this component's own state — see
 *      ChatTranscript for why that rule is worth the moment it costs.
 *   4. The send fails. THE TEXT STAYS, in the box and in storage, and a sentence says which
 *      failure it was. It never says "sent" when it is not.
 *
 * ====================================================================================
 * WHAT THIS DELIBERATELY DOES NOT DO, UNLIKE THE NOTE EDITOR TWO CARDS DOWN
 * ====================================================================================
 *
 * NO DEBOUNCED AUTO-SEND. `SYNC_DEBOUNCE_MS` exists because a note SYNCS — every save appends
 * a permanent row and five seconds of idle keeps that to a handful. A message is not synced,
 * it is SENT, and a half-finished sentence sent to a patient on a timer is a clinical
 * instruction they may act on before it is finished. The only thing that sends a message is a
 * press.
 *
 * NO CONFLICT DETECTION. The note has one because two clinicians can write the same section
 * and a machine picking one destroys evidence. A conversation has no such thing: two messages
 * are two messages, in order, and the correction for a wrong one is the next one.
 *
 * STORAGE THROWS RATHER THAN RETURNING NULL when a browser refuses it — private browsing, a
 * managed device with site data blocked, which is not exotic on a clinic's own laptops. Every
 * access is wrapped, and a failure to persist never takes the composer down: the network path
 * still works, and the clinician is told the local copy is missing rather than left believing
 * in a safety net that is not there.
 */
export function ChatComposer({
  consultationId,
  userId,
  messageCount,
}: {
  consultationId: string
  /** Scopes the draft key, so a second clinician on a shared handset finds their own empty box. */
  userId: string
  /**
   * How many messages the server rendered above this box.
   *
   * Not decoration. It is how the composer knows its own message has ARRIVED: the count
   * changes when `router.refresh()` brings back a transcript containing it, and the "sent,
   * waiting for it to appear" line stands down. Without it the status would either vanish
   * before the line is on screen — which reads as the message being lost — or hang about
   * after it.
   */
  messageCount: number
}) {
  const router = useRouter()
  const key = chatDraftKey(userId, consultationId)

  const [body, setBody] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | SendFailure>('idle')
  const [storageBroken, setStorageBroken] = useState(false)

  /*
   * The count as it was when the send returned. Compared against the prop on every render:
   * when the server's transcript grows past it, the message is on screen. A ref rather than
   * state because changing it must not itself cause a render.
   */
  const countWhenSent = useRef<number | null>(null)

  /*
   * Restoring the draft happens in an effect and NOT in `useState`'s initialiser, because this
   * component is server-rendered first: reading `localStorage` during the initial render would
   * run on the server, where it does not exist, and hydrate a box whose contents disagree with
   * the markup. One frame of empty textarea is the price of not having a hydration mismatch on
   * a clinical surface.
   */
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key)

      if (stored !== null && stored !== '') {
        setBody(stored)
      }
    } catch {
      setStorageBroken(true)
    }
  }, [key])

  useEffect(() => {
    if (countWhenSent.current !== null && messageCount > countWhenSent.current) {
      countWhenSent.current = null
      setStatus('idle')
    }
  }, [messageCount])

  const persist = useCallback(
    (value: string) => {
      try {
        if (value === '') {
          window.localStorage.removeItem(key)

          return
        }

        window.localStorage.setItem(key, value)
      } catch {
        // Reported once by the notice above the box. Swallowed here on purpose: throwing out
        // of a keystroke handler would take the composer down, and the network path — the one
        // that actually delivers the message — is unaffected.
        setStorageBroken(true)
      }
    },
    [key],
  )

  const change = useCallback(
    (value: string) => {
      setBody(value)
      persist(value)

      // A typed character means the previous outcome is no longer what the clinician is
      // looking at. Clearing it here rather than on submit stops a stale "could not send"
      // sitting under an instruction that has since been rewritten.
      setStatus((current) => (current === 'sending' ? current : 'idle'))
    },
    [persist],
  )

  const submit = useCallback(async () => {
    const verdict = checkLength(body)

    if (verdict === 'empty') {
      return
    }

    if (verdict === 'too-long') {
      // Refused locally and NOT truncated. Sending the first 4,000 characters of a clinical
      // instruction is how "…and stop the warfarin" disappears.
      setStatus('too-long')

      return
    }

    setStatus('sending')

    const result = await sendConsultationMessage(consultationId, body)

    if (!result.ok) {
      // THE TEXT STAYS. In the box and in storage. A failed send must never cost a clinician
      // the words they typed, least of all on the connection this product is designed for.
      setStatus(result.reason)

      return
    }

    countWhenSent.current = messageCount
    setStatus('sent')
    setBody('')
    persist('')

    router.refresh()
  }, [body, consultationId, messageCount, persist, router])

  const sending = status === 'sending'
  const failure = FAILURES.includes(status as SendFailure) ? (status as SendFailure) : null

  return (
    <Stack gap="4" as="section">
      {storageBroken ? (
        <Notice tone="warn" icon="shield" title="This browser is not keeping a local copy">
          Private browsing, or a setting that blocks site data, stops your draft being saved on
          this device. Sending still works — but if the connection drops mid-sentence, anything
          not yet sent is gone.
        </Notice>
      ) : null}

      <Stack gap="3">
        {/* `Field` and not a hand-rolled label, because the four attributes that make a control
            legible to a screen reader — htmlFor, id, aria-describedby, aria-invalid — have to
            agree, and a page where they do not still LOOKS right. */}
        <Field
          name="body"
          id="consultation-message"
          label="Write to the patient"
          hint="Kept on this device as you type, until it has been sent. The patient sees it in their portal, never as a text message."
        >
          {(control) => (
            <Textarea
              {...control}
              rows={3}
              value={body}
              /* NO `maxLength`. The attribute silently refuses keystrokes past the limit,
                 which on a pasted instruction means the tail is gone with nothing said. The
                 limit is enforced by `checkLength` on submit, where it produces a sentence. */
              onChange={(event) => change(event.target.value)}
              disabled={sending}
            />
          )}
        </Field>

        <div>
          {/* `.btn` is inline-flex, so a bare flex child would be stretched across the card,
              and a full-bleed Send would read as the screen's primary action — which it is
              not; ending the consultation is. The wrapper keeps it the width of its label. */}
          <Button variant="primary" type="button" onClick={() => void submit()} disabled={sending}>
            {sending ? 'Sending…' : 'Send'}
          </Button>
        </div>
      </Stack>

      {status === 'sent' ? <p className="fine">Sent. Waiting for it to appear above.</p> : null}

      {failure === null ? null : (
        /*
         * `too-long` arrives here as well as the wire failures, deliberately: a message the
         * local check refused and one the API refused are the same fact to the person holding
         * the phone, and they should not read as two different problems.
         */
        <Notice tone="bad" icon="help">
          {FAILURE_TEXT[failure]}
        </Notice>
      )}
    </Stack>
  )
}

/**
 * The failure words, as a runtime list.
 *
 * `SendFailure` is a union of string literals and unions do not survive to runtime, so the
 * narrowing above needs a value to test against. A member added to the type and not to this
 * list shows up immediately as a `Record` that no longer type-checks below.
 */
const FAILURES: readonly SendFailure[] = ['ended', 'refused', 'session', 'too-long', 'offline', 'failed']

/**
 * One sentence each, written for the person who triggered it, and none of them the API's own.
 *
 * The same closed-set discipline `ConsultationRoom`'s `classify()` applies to `?problem=`: the
 * screen speaks a fixed vocabulary rather than printing whatever came back. Every one of them
 * says where the text is, because that is the first thing anybody wants to know.
 */
const FAILURE_TEXT: Record<SendFailure, string> = {
  ended: 'The consultation was closed while you were typing, so this was not sent. Your words are still in the box — if it needs saying, it needs a new appointment or a telephone call.',
  refused: 'The clinic’s server would not accept this message. Open the consultation again from the schedule; if it keeps happening, this is one for whoever runs the console. Your words are still in the box.',
  session: 'Your session ended while this page was open, so nothing was sent. Sign in again and open this consultation. Your words are still in the box.',
  'too-long': 'This message is too long to send. Nothing has been shortened for you — send it in two parts rather than losing the end of it, or write it as a note instead.',
  offline: 'This did not get through. It may still have arrived — look above before writing it again, so the patient does not get the same instruction twice. Your words are still in the box.',
  failed: 'Something went wrong sending this. Try once more. Your words are still in the box.',
}
