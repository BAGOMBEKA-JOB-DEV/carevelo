'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field, Notice, Stack, Textarea } from '@carevelo/ui'
import { sendConsultationMessage } from '../api/actions'
import { chatDraftKey, checkLength, type SendFailure } from '../model/chat'

/**
 * The box a patient types into — the second and last `'use client'` module in this domain.
 *
 * ====================================================================================
 * THE DIRECTIVE IS EARNED, AND BY A REQUIREMENT RATHER THAN A CONVENIENCE
 * ====================================================================================
 *
 * A draft must survive a navigation. This room re-renders on its own every fifteen seconds
 * whenever the clinician changes something — starts the consultation, steps it down to
 * voice, ends it — and a patient half-way through describing a symptom when one of those
 * lands must not lose the sentence. Persisting on a keystroke needs a keystroke handler;
 * reading it back needs browser storage; neither exists on a server.
 *
 * AND `'use client'` DRAGS ITS WHOLE IMPORT GRAPH INTO THE BROWSER BUNDLE, which is why the
 * imports above are four UI primitives, the router, one server action and a pure model
 * module. `../api/messages` is NOT imported here: it pulls `next/headers` through the
 * gateway, and it is reached only through the action.
 *
 * ====================================================================================
 * THE ORDER OF OPERATIONS, WHICH IS THE WHOLE DESIGN
 * ====================================================================================
 *
 *   1. The patient types. The text goes to `sessionStorage` SYNCHRONOUSLY, in the same tick.
 *      Not after a debounce, not after a render.
 *   2. They press send. The box KEEPS THE TEXT and the button locks. On a mid-range Android
 *      on Ugandan mobile data this request can take many seconds, and the one thing that
 *      must not happen is the words disappearing while it is in flight.
 *   3. The send succeeds. Only THEN are the box and the stored draft cleared, and
 *      `router.refresh()` re-renders the room so the message appears in the transcript
 *      ABOVE — from the server, read back through the API. It is never echoed out of this
 *      component's own state. See ChatTranscript for why that rule is worth the moment it
 *      costs.
 *   4. The send fails. THE TEXT STAYS, in the box and in storage, and a sentence appears
 *      saying which failure it was. It never says "sent" when it is not.
 *
 * ====================================================================================
 * WHY `sessionStorage` AND NOT `localStorage`
 * ====================================================================================
 *
 * The full argument is on `CHAT_DRAFT_PREFIX` in ../model/chat.ts. In one line: the console
 * pays for `localStorage` with a `clearAllDrafts()` sweep on a sign-out control that domain
 * owns, and this app's sign-out is a Server Action which cannot reach browser storage — so
 * rather than leave a patient's own words about their health in a borrowed handset's
 * `localStorage` with nothing arranged to remove them, the draft is scoped to the tab and
 * disappears with it. It still survives every re-render, reload and same-tab navigation,
 * which is the whole of the requirement.
 *
 * STORAGE THROWS RATHER THAN RETURNING NULL when a browser refuses it — private browsing,
 * a managed device with site data blocked. Every access is wrapped, and a failure to
 * persist never takes the composer down: the network path still works, and the person is
 * told their draft is not being kept rather than left believing in a safety net that is not
 * there.
 */

/** Every sentence this component can say, translated on the server and handed down. */
export type ComposerCopy = {
  readonly label: string
  readonly hint: string
  readonly send: string
  readonly sending: string
  readonly sent: string
  readonly storageBroken: string
  readonly failure: Readonly<Record<SendFailure, string>>
}

export function ChatComposer({
  consultationId,
  messageCount,
  copy,
}: {
  consultationId: string
  /**
   * How many messages the server rendered above this box.
   *
   * Not decoration. It is how the composer knows its own message has ARRIVED: the count
   * changes when `router.refresh()` brings back a transcript containing it, and the "sent,
   * waiting for it to appear" line stands down. Without it the status would either vanish
   * too early — before the line is on screen, which reads as the message being lost — or
   * hang about after it.
   */
  messageCount: number
  copy: ComposerCopy
}) {
  const router = useRouter()
  const key = chatDraftKey(consultationId)

  const [body, setBody] = useState('')
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | SendFailure>('idle')
  const [storageBroken, setStorageBroken] = useState(false)

  /*
   * The count as it was when the send returned. Compared against the prop on every render:
   * when the server's transcript grows past it, the message is on screen and the status
   * line has done its job. A ref rather than state because changing it must not itself
   * cause a render.
   */
  const countWhenSent = useRef<number | null>(null)

  /*
   * Restoring the draft happens in an effect and NOT in `useState`'s initialiser, because
   * this component is server-rendered first: reading `sessionStorage` during the initial
   * render would run on the server, where it does not exist, and hydrate a box whose
   * contents disagree with the markup. The one frame of empty textarea is the price of not
   * having a hydration mismatch on a clinical surface.
   */
  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(key)

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
          window.sessionStorage.removeItem(key)

          return
        }

        window.sessionStorage.setItem(key, value)
      } catch {
        // Reported once by the notice above the box. Swallowed here on purpose: throwing out
        // of a keystroke handler would take the composer down, and the network path — which
        // is the one that actually delivers the message — is unaffected.
        setStorageBroken(true)
      }
    },
    [key],
  )

  const change = useCallback(
    (value: string) => {
      setBody(value)
      persist(value)

      // A typed character means the previous outcome is no longer what the person is looking
      // at. Clearing it here rather than on submit stops a stale "could not send" sitting
      // under a message that has since been rewritten.
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
      // Refused locally and NOT truncated. See `checkLength`: sending the first 4,000
      // characters of a clinical instruction is how the second half of it disappears.
      setStatus('too-long')

      return
    }

    setStatus('sending')

    const result = await sendConsultationMessage(consultationId, body)

    if (!result.ok) {
      // THE TEXT STAYS. In the box and in storage. A failed send must never cost somebody
      // the words they typed, least of all on the connection this product is designed for.
      setStatus(result.reason)

      return
    }

    countWhenSent.current = messageCount
    setStatus('sent')
    setBody('')
    persist('')

    // The message is read back from the server rather than echoed from here. See
    // ChatTranscript for the rule and what it buys.
    router.refresh()
  }, [body, consultationId, messageCount, persist, router])

  const sending = status === 'sending'
  const failure = FAILURES.includes(status as SendFailure) ? (status as SendFailure) : null

  return (
    <Stack gap="4" as="section">
      {storageBroken ? (
        <Notice tone="warn" icon="shield" title={copy.storageBroken} announce={false}>
          {copy.hint}
        </Notice>
      ) : null}

      <Stack gap="3">
        {/* `Field` and not a hand-rolled label, because the four attributes that make a
            control legible to a screen reader — htmlFor, id, aria-describedby, aria-invalid
            — have to agree, and a page where they do not still LOOKS right. It owns the
            wiring so that this call site cannot skip it. */}
        <Field name="body" id="consultation-message" label={copy.label} hint={copy.hint}>
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
          {/* `.btn` is inline-flex, so a bare flex child would be stretched the full width of
              the card and a send button would read as the page's primary action. */}
          <Button variant="primary" type="button" onClick={() => void submit()} disabled={sending}>
            {sending ? copy.sending : copy.send}
          </Button>
        </div>
      </Stack>

      {status === 'sent' ? <p className="fine">{copy.sent}</p> : null}

      {failure === null ? null : (
        /*
         * `too-long` arrives here as well as the wire failures, and deliberately: a message
         * the local check refused and one the API refused are the same fact to the person
         * holding the phone, and they should not read as two different problems.
         */
        <Notice tone="bad" icon="help">
          {copy.failure[failure]}
        </Notice>
      )}
    </Stack>
  )
}

/**
 * The failure words, as a runtime list.
 *
 * `SendFailure` is a union of string literals and unions do not survive to runtime, so the
 * narrowing above needs a value to test against. Kept beside the type it mirrors; a member
 * added to one and not the other shows up as a `Record` that no longer type-checks in
 * `ComposerCopy`.
 */
const FAILURES: readonly SendFailure[] = ['ended', 'refused', 'session', 'too-long', 'offline', 'failed']
