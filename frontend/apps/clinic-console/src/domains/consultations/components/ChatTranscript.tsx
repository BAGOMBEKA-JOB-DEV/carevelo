import { DateTime, Stack } from '@carevelo/ui'
import { sideOf, type ConsultationMessage } from '../model/chat'

/**
 * The conversation, rendered on the server and only ever on the server.
 *
 * ====================================================================================
 * NO BODY IN THIS PRODUCT IS EVER RENDERED FROM A CLIENT-HELD VALUE
 * ====================================================================================
 *
 * `@carevelo/realtime`'s central rule — "a frame is a hint to re-fetch, it is never the thing
 * itself" — is usually argued about broadcasts. It applies at least as hard to the composer
 * below: after a successful send, `ChatComposer` clears its box and calls `router.refresh()`,
 * and the message the clinician just wrote appears HERE, from a server render, having been
 * read back through the API under the policy and row-level security. It is never echoed
 * optimistically out of the textarea.
 *
 * That costs a visible moment on a bad connection, which is why the composer says "sent,
 * waiting for it to appear" rather than leaving a gap. It buys three things: the transcript
 * on screen is what the record holds and not what a browser hoped it holds; the re-render
 * runs the whole authorisation again; and a send that half-failed cannot leave a clinical
 * instruction on screen that exists nowhere in the record.
 *
 * ====================================================================================
 * `<pre class="verbatim">`, THE SAME ELEMENT THE NOTE IS DRAWN IN
 * ====================================================================================
 *
 * console.css §14 — "TEXT THAT MUST SURVIVE EXACTLY AS IT WAS TYPED". Without `pre-wrap`
 * every newline collapses to a single space, "and that is not a styling regression; it is the
 * loss of structure the author deliberately put there". A clinician listing three medicines
 * on three lines means three lines. Nothing here shortens, ellipsises, previews or reformats.
 *
 * WORTH KNOWING: the patient portal renders the same bodies differently — one paragraph per
 * line inside a `Stack` — because that app imports `@carevelo/ui/tokens.css` and nothing else,
 * has no stylesheet of its own to put a `pre-wrap` rule in, and an inline style is banned. It
 * loses runs of blank lines where this does not. The console has `console.css`, so the console
 * gets the exact rendering.
 *
 * ====================================================================================
 * WHO SAID WHAT COMES FROM THE SERVER'S OWN `author_role`
 * ====================================================================================
 *
 * Denormalised onto the row by `ConsultationMessageController`, derived from the
 * authorisation decision that permitted the write and never from anything a client sent —
 * `StoreConsultationMessageRequest` has no such field. So attribution is a comparison of two
 * role words, which keeps the transcript readable years later when the account that wrote a
 * line has been deactivated.
 */
export function ChatTranscript({
  messages,
  viewer,
}: {
  messages: readonly ConsultationMessage[]
  /** The role this reader holds — `'clinician'` here, always. Decides which side is "you". */
  viewer: string
}) {
  if (messages.length === 0) {
    return <p className="muted">Nothing has been written in this consultation yet.</p>
  }

  return (
    <Stack gap="5" as="ol">
      {messages.map((message) => (
        <Stack gap="2" as="li" key={message.id}>
          <p className="fine">
            {sideOf(message, viewer) === 'mine' ? 'You' : 'The patient'}
            {message.created_at === null ? null : (
              <>
                {' · '}
                <DateTime value={message.created_at} format="time" />
              </>
            )}
          </p>

          {/* See the docblock: `.verbatim` carries `pre-wrap`, the body face and a zeroed
              margin, and it is the same element the clinical note is drawn in. A clinician's
              line breaks are part of what they wrote. */}
          <pre className="verbatim">{message.body}</pre>
        </Stack>
      ))}
    </Stack>
  )
}
