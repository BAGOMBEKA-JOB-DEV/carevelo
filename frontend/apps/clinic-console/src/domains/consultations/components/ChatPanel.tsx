import { Card, Notice, Stack } from '@carevelo/ui'
import { chatPanelState, type ConsultationMessage } from '../model/chat'
import type { Consultation } from '../model/types'
import { ChatComposer } from './ChatComposer'
import { ChatTranscript } from './ChatTranscript'

/**
 * Messages inside the consultation — the clinician's side, which did not exist at all.
 *
 * ====================================================================================
 * THE ASYMMETRY THIS CLOSES, AND WHY IT WAS THE WORSE HALF
 * ====================================================================================
 *
 * The patient portal has carried a chat panel since it was built. It said, honestly, that
 * typing there would reach nobody. This console carried NOTHING — no panel, no placeholder,
 * no mention — while `ModeControl` two cards up has always offered the clinician the choice
 * of stepping the consultation down into `chat`. A clinician could put a consultation into a
 * mode this screen had no surface for, and the record would say the encounter was held by
 * chat when nothing on either side could carry one.
 *
 * All of it exists now: `consultation_messages` is a table under row-level security,
 * `ConsultationMessageController` serves both verbs, and both are in `docs/40-api/openapi.yaml`
 * and in `@carevelo/api-client`, generated rather than typed out.
 *
 * ====================================================================================
 * WHERE IT SITS ON THE SCREEN, WHICH IS AN ARGUMENT AND NOT A LAYOUT CHOICE
 * ====================================================================================
 *
 * Directly under the media pane and ABOVE the note. The room's own docblock sets the order:
 * "one screen, one column, mobile first", and the DOM order is what a screen reader and a
 * thumb both follow. What the patient is saying belongs next to the thing that is failing to
 * show them — and before the note, because the note is written FROM what was said.
 *
 * ====================================================================================
 * CHAT IS NOT A FALLBACK, AND IT IS THE THING THAT WORKS WHEN VIDEO DOES NOT
 * ====================================================================================
 *
 * Both are true at once. It is drawn in every mode, not conjured when something fails,
 * because text is the right channel for a medicine name or a dose that is awkward spoken
 * aloud down a bad line. And it is served entirely by this platform:
 * `ConsultationMessageController` reads no video configuration, mints no join token and asks
 * no media server anything. Now that the SFU is ours to operate, the outage the threat model
 * describes is one we cause — so the thing we degrade to has to be one we operate too.
 *
 * ====================================================================================
 * WHO CAN SEE THIS, WHICH IS NARROWER THAN THE NOTE BESIDE IT
 * ====================================================================================
 *
 * `ConsultationPolicy::participate` — the patient, and the clinician conducting THIS
 * encounter. Not a covering colleague, not the clinic administrator. The note is `view` and
 * is clinic-wide. So a clinician looking at a colleague's consultation sees the record and a
 * panel that says it cannot show the conversation, which is the true thing to say. Do not
 * widen it from this side; the way to grant care-team access is to change the ability,
 * audited.
 *
 * @see backend/app/Http/Controllers/Api/V1/ConsultationMessageController.php
 * @see docs/30-architecture/realtime-and-video.md — degradation; chat is not a fallback
 */
export function ChatPanel({
  consultation,
  messages,
  userId,
}: {
  /** Null when the encounter has not been started. */
  consultation: Consultation | null
  /** Null means the transcript could not be read — NOT that there is nothing in it. */
  messages: readonly ConsultationMessage[] | null
  /** The signed-in clinician's user id. Scopes the draft's storage key. */
  userId: string
}) {
  /*
   * ONE DECISION, TAKEN IN ONE PLACE AND TESTED THERE. Three of the four outcomes look alike
   * on screen — a neutral notice where a box would be — and mean entirely different things,
   * so the choice between them does not belong inline in JSX where nothing can drive it.
   */
  const state = chatPanelState(consultation, messages)

  return (
    <Card as="section" aria-labelledby="chat-heading">
      <Stack gap="5">
        {/* A bare `.stack` before this — 6px in the reset — so `gap="2"`, matching the note
            card two down. */}
        <Stack gap="2">
          <h2 id="chat-heading" className="title-sm">
            Messages
          </h2>
          <p className="fine">
            What you and the patient have written to each other during this consultation. It is
            part of the clinical record, it is kept in the clinic&rsquo;s own database, and it is
            never sent to the patient as a text message.
          </p>
        </Stack>

        {messages === null ? (
          <Notice tone="warn" icon="help" title="The conversation cannot be shown" announce={false}>
            This is a failure to read it, not a sign that there is nothing there — do not treat
            it as an empty conversation. Only the patient and the clinician holding this
            consultation may read the messages, so a colleague&rsquo;s consultation will always
            look like this. Otherwise, open the consultation again from the schedule.
          </Notice>
        ) : (
          <ChatTranscript messages={messages} viewer="clinician" />
        )}

        {state === 'composing' && consultation !== null && messages !== null ? (
          <ChatComposer
            consultationId={consultation.id}
            userId={userId}
            messageCount={messages.length}
          />
        ) : null}

        {state === 'not-started' ? (
          <Notice tone="neutral" icon="mail" title="Nothing to write to yet" announce={false}>
            The consultation has not been started, so there is no encounter for a message to
            belong to. Open the door above first.
          </Notice>
        ) : null}

        {state === 'closed' ? (
          <Notice tone="neutral" icon="mail" title="This consultation is closed to new messages" announce={false}>
            Everything written during it stays here and in the patient&rsquo;s record. The note
            below still accepts an addendum — a note is addressed to the record, so it may be
            written up afterwards — but a message is addressed to a person, and the patient has
            no reason to be watching this consultation any more. Continuing care needs a new
            appointment.
          </Notice>
        ) : null}
      </Stack>
    </Card>
  )
}
