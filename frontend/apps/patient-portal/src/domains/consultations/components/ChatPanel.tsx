import { getTranslations } from 'next-intl/server'
import { Card, Notice, Stack } from '@carevelo/ui'
import { chatPanelState, type ConsultationMessage } from '../model/chat'
import type { Consultation } from '../api/consultations'
import { ChatComposer } from './ChatComposer'
import { ChatTranscript } from './ChatTranscript'

/**
 * Messages inside the consultation — and this panel is now the feature rather than a note
 * saying there isn't one.
 *
 * ====================================================================================
 * WHAT LANDED, AND WHY THAT CHANGES WHAT THIS FILE MAY DO
 * ====================================================================================
 *
 * This panel used to render a `<Notice>` saying that typing here would reach nobody, and
 * its docblock was right about why: `chat` was a `ConsultationMode` with no table, no
 * model, no route and nothing in the generated client, and "a plausible empty state for a
 * feature that does not exist" is exactly what `<EmptyState>` refuses to be used for.
 *
 * All four of those now exist. `consultation_messages` is a table under row-level security
 * with a composite foreign key to its consultation; `ConsultationMessageController` serves
 * `GET`/`POST /v1/consultations/{consultation}/messages`; both are in
 * `docs/40-api/openapi.yaml` and in `@carevelo/api-client`, generated rather than typed out.
 * So the placeholder goes and the box arrives — which is the only order those two events
 * were ever allowed to happen in.
 *
 * ====================================================================================
 * CHAT IS NOT A FALLBACK, AND IT IS THE THING THAT WORKS WHEN VIDEO DOES NOT
 * ====================================================================================
 *
 * Both of those are true at once and the panel is placed on the strength of them. It is
 * rendered in EVERY mode, not conjured when something fails, because text is the right
 * channel for a medicine name or a dose that is awkward spoken aloud down a bad line.
 *
 * And it is served entirely by this platform: `ConsultationMessageController` reads no
 * video configuration, mints no join token and asks no media server anything. That is why
 * the media pane above can say "there is no picture" and point down here — the outage that
 * takes the SFU away is one we operate, and the thing it degrades to has to be one we
 * operate too.
 *
 * ====================================================================================
 * WHAT EACH ABSENCE OF A COMPOSER MEANS, SAID RATHER THAN IMPLIED
 * ====================================================================================
 *
 * There are three states in which the box is NOT drawn, and each gets its own sentence
 * rather than a greyed-out control:
 *
 *   nothing started    the clinician has not opened the consultation, so there is no record
 *                      a message could belong to and the API would answer 404.
 *   ended              `assertStillInProgress` answers 409, and says why in as many words:
 *                      a patient typing a new symptom into a closed consultation "reasonably
 *                      believes a clinician is reading it. Nobody is." A disabled box makes
 *                      that promise just as loudly as an enabled one.
 *   unreadable         the transcript could not be read at all. Distinct from an empty one,
 *                      and it must be: drawing an empty conversation over a real one, on a
 *                      screen where a clinician may have written "go to the hospital now",
 *                      is the worst available answer.
 *
 * READING IS NEVER GATED. The transcript stays for ever, including after the encounter
 * ends, because the conversation is part of the medical record and a record you cannot read
 * back is not one.
 *
 * @see backend/app/Http/Controllers/Api/V1/ConsultationMessageController.php
 * @see docs/30-architecture/realtime-and-video.md — degradation; chat is not a fallback
 */
export async function ChatPanel({
  clinic,
  consultation,
  messages,
}: {
  clinic: string
  /** Null until the clinician starts the consultation, which is the state on arrival. */
  consultation: Consultation | null
  /** Null means the transcript could not be read — NOT that there is nothing in it. */
  messages: readonly ConsultationMessage[] | null
}) {
  const t = await getTranslations('Consultations')

  /*
   * ONE DECISION, TAKEN IN ONE PLACE AND TESTED THERE. Three of the four outcomes look
   * alike on screen — a neutral notice where a box would be — and mean entirely different
   * things, so the choice between them does not belong inline in JSX where nothing can
   * drive it.
   */
  const state = chatPanelState(consultation, messages)

  return (
    <Card as="section" aria-labelledby="consultation-chat">
      <Stack gap="4">
        <h2 className="title" id="consultation-chat">
          {t('chatTitle')}
        </h2>

        {/* Said once, at the top, and it is the fact that decides whether somebody writes
            something they would not say out loud: this stays in the clinical record with the
            clinic and is never sent to their phone as a text message. */}
        <p className="fine">{t('chatLede', { clinic })}</p>

        {messages === null ? (
          <Notice tone="warn" icon="help" title={t('chatUnreadableTitle')} announce={false}>
            {t('chatUnreadableBody', { clinic })}
          </Notice>
        ) : (
          <ChatTranscript messages={messages} viewer="patient" />
        )}

        {state === 'composing' && consultation !== null && messages !== null ? (
          <ChatComposer
            consultationId={consultation.id}
            messageCount={messages.length}
            copy={{
              label: t('chatLabel'),
              hint: t('chatHint'),
              send: t('chatSend'),
              sending: t('chatSending'),
              sent: t('chatSent'),
              storageBroken: t('chatStorageBroken'),
              failure: {
                ended: t('chatFailedEnded'),
                refused: t('chatFailedRefused'),
                session: t('chatFailedSession'),
                'too-long': t('chatFailedTooLong'),
                offline: t('chatFailedOffline'),
                failed: t('chatFailedGeneric'),
              },
            }}
          />
        ) : null}

        {state === 'not-started' ? (
          <Notice tone="neutral" icon="mail" title={t('chatNotStartedTitle')} announce={false}>
            {t('chatNotStartedBody')}
          </Notice>
        ) : null}

        {state === 'closed' ? (
          <Notice tone="neutral" icon="mail" title={t('chatClosedTitle')} announce={false}>
            {t('chatClosedBody', { clinic })}
          </Notice>
        ) : null}
      </Stack>
    </Card>
  )
}
