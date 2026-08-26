import { getTranslations } from 'next-intl/server'
import { DateTime, Stack } from '@carevelo/ui'
import { messageLines, sideOf, type ConsultationMessage } from '../model/chat'

/**
 * The conversation, rendered on the server and only ever on the server.
 *
 * ====================================================================================
 * NO BODY IN THIS PRODUCT IS EVER RENDERED FROM A CLIENT-HELD VALUE
 * ====================================================================================
 *
 * `@carevelo/realtime`'s central rule — "a frame is a hint to re-fetch, it is never the
 * thing itself" — is usually argued about broadcasts. It applies at least as hard to the
 * composer sitting under this list: after a successful send, `ChatComposer` clears its box
 * and calls `router.refresh()`, and the message the patient just wrote appears HERE, from a
 * server render, having been read back through the API under the policy and row-level
 * security. It is never echoed optimistically out of the textarea.
 *
 * That costs a visible moment on a slow connection, which is why the composer says "sent,
 * waiting for it to appear" rather than leaving a gap. It buys three things: the transcript
 * on screen is what the record holds and not what a browser hoped it holds; the re-render
 * runs the whole authorisation again; and a send that half-failed cannot leave a line on
 * screen that exists nowhere in the record.
 *
 * ====================================================================================
 * WHO SAID WHAT COMES FROM THE SERVER'S OWN `author_role`
 * ====================================================================================
 *
 * Denormalised onto the row by `ConsultationMessageController`, derived from the
 * authorisation decision that permitted the write and never from anything a client sent —
 * `StoreConsultationMessageRequest` has no such field and `RejectsUnknownFields` turns an
 * attempt into a 422. So attribution here is a comparison of two role words, which is what
 * keeps the transcript readable years later when the account that wrote a line has been
 * deactivated.
 *
 * NOTHING CLINICAL LEAVES THIS COMPONENT. It renders. It does not summarise, it does not
 * preview, it does not put a body in a title attribute, and it does not shorten.
 */
export async function ChatTranscript({
  messages,
  viewer,
}: {
  messages: readonly ConsultationMessage[]
  /** The role this reader holds — `'patient'` here, always. Decides which side is "you". */
  viewer: string
}) {
  const t = await getTranslations('Consultations')

  if (messages.length === 0) {
    return <p className="muted">{t('chatEmpty')}</p>
  }

  return (
    <Stack gap="5" as="ol">
      {messages.map((message) => {
        const side = sideOf(message, viewer)

        return (
          <Stack gap="2" as="li" key={message.id}>
            <p className="fine">
              {side === 'mine' ? t('chatFromYou') : t('chatFromClinician')}
              {message.created_at === null ? null : (
                <>
                  {' · '}
                  <DateTime value={message.created_at} format="time" />
                </>
              )}
            </p>

            {/* ONE PARAGRAPH PER LINE. The break is carried by the Stack because this app
                owns no stylesheet and `white-space: pre-wrap` has nowhere to live — the
                whole argument, and the one thing it loses, is on `messageLines`. */}
            {messageLines(message.body).map((paragraph, index) => (
              /* Index as key: the lines of one immutable message, never reordered, no
                 state of their own. Messages themselves are keyed by id. */
              <p key={index}>{paragraph}</p>
            ))}
          </Stack>
        )
      })}
    </Stack>
  )
}
