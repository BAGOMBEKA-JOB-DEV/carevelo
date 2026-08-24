import { Button, Card, Icon, Inline, Notice, Stack } from '@carevelo/ui'
import {
  asMode,
  MODE_DEMAND,
  MODE_LABEL,
  REMOTE_MODES,
  type Consultation,
  type ConsultationMode,
} from '../model/types'

/**
 * WHAT MODE THIS CONSULTATION IS ACTUALLY BEING HELD IN — announced, never assumed.
 *
 * ====================================================================================
 * "MODE DEGRADATION IS VISIBLE AND HONEST. VIDEO → VOICE → CHAT, WITH THE PATIENT TOLD
 * WHAT HAPPENED RATHER THAN LEFT WATCHING A FROZEN FRAME."
 * ====================================================================================
 *
 * This is the clinician's half of that sentence. Pressing one of these buttons writes
 * `mode_used` on the consultation; the patient portal reads the same field and renders the
 * difference between what was booked and what is being held. So the announcement is not a
 * message this console sends — it is a FACT this console records, which the patient's screen
 * then states. There is no second copy of the truth to keep in step.
 *
 * WHY A CLINICIAN PRESSES IT RATHER THAN A MONITOR DETECTING IT. With no video provider there
 * is no connection to measure — but even with one, a bandwidth heuristic deciding that an
 * encounter "was really voice" is a clinical record written by a guess. The clinician knows
 * what happened. `ConsultationController::recordMode` records it and says why: reporting the
 * booked mode instead "would misstate the encounter clinically and would flatter us
 * commercially, which is the reason the temptation exists."
 *
 * THE STEP BACK UP IS OFFERED TOO. The state machine allows both directions, and a control
 * that only degraded would make a clinician whose connection recovered leave the record
 * saying voice. All three modes are peers here: same button, same weight, no "downgrade to"
 * language on any of them.
 *
 * `in_person` IS ABSENT AND ITS ABSENCE IS THE DESIGN. `RecordModeRequest` refuses it: a
 * remote consultation does not become an in-person one by changing a field. The clinician who
 * decides the patient must be seen ENDS the consultation with `converted_to_in_person`, which
 * is a different act with a permanent consequence — no prescription may be issued on it — and
 * that control lives in `EndConsultation`, deliberately not here.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md §4
 */
export function ModeControl({
  consultation,
  bookedMode,
  action,
}: {
  consultation: Consultation
  bookedMode: ConsultationMode | null
  action: (formData: FormData) => Promise<void>
}) {
  const used = asMode(consultation.mode_used)

  return (
    <Card as="section" aria-labelledby="mode-heading">
      <Stack gap="4">
        <h2 id="mode-heading" className="title-sm">
          How this consultation is being held
        </h2>

        <ModeAnnouncement bookedMode={bookedMode} used={used} />

        {/* The row of buttons is an `<Inline>` INSIDE the form rather than the form itself
            being the flex row: Stack and Inline take semantic grouping elements and a `<form>`
            is not one — its element is chosen by what it submits, never by how its controls
            are arranged. The form stays a plain block and the row states its 8px, which is
            tighter than `.row-wrap`'s own 12px because these three are one control in three
            positions rather than three separate things to press. */}
        <form action={action}>
          <Inline gap="3">
            {REMOTE_MODES.map((mode) => (
              <Button
                key={mode}
                type="submit"
                name="mode"
                value={mode}
                variant={mode === used ? 'primary' : 'quiet'}
                aria-pressed={mode === used}
              >
                <Icon name={MODE_ICON[mode]} /> {MODE_LABEL[mode]}
              </Button>
            ))}
          </Inline>
        </form>

        <p className="fine">
          Changing this records what is really happening and tells the patient on their own
          screen. It does not switch anything over for you — nothing here controls a connection.
        </p>
      </Stack>
    </Card>
  )
}

/**
 * The sentence, which is the part that matters.
 *
 * A COLOURED BUTTON IS NOT AN ANNOUNCEMENT. The step-down has to be readable as words by
 * somebody who cannot see which button is filled in, so the difference between what was booked
 * and what is being held is written out, and the notice's `role` carries it to a screen
 * reader.
 */
function ModeAnnouncement({
  bookedMode,
  used,
}: {
  bookedMode: ConsultationMode | null
  used: ConsultationMode | null
}) {
  if (used === null) {
    // A mode the contract does not know about. Saying nothing is better than asserting
    // something wrong about how a patient is being seen; the buttons below still work.
    return null
  }

  if (bookedMode === null || bookedMode === used) {
    return (
      <Notice tone="info" icon="activity" title={`Being held by ${MODE_LABEL[used].toLowerCase()}`} announce={false}>
        This is what the patient booked. Their screen says the same.
      </Notice>
    )
  }

  const steppedDown = MODE_DEMAND[used] < MODE_DEMAND[bookedMode]

  return steppedDown ? (
    <Notice
      tone="warn"
      icon="activity"
      title={`Stepped down from ${MODE_LABEL[bookedMode].toLowerCase()} to ${MODE_LABEL[used].toLowerCase()}`}
    >
      The record says this consultation is being held by {MODE_LABEL[used].toLowerCase()}, not
      the {MODE_LABEL[bookedMode].toLowerCase()} that was booked. The patient has been told
      that on their own screen — they are not sitting in front of a frozen picture wondering.
    </Notice>
  ) : (
    <Notice
      tone="info"
      icon="activity"
      title={`Moved up from ${MODE_LABEL[bookedMode].toLowerCase()} to ${MODE_LABEL[used].toLowerCase()}`}
    >
      The connection allowed more than was booked. The record and the patient&rsquo;s screen
      both say so.
    </Notice>
  )
}

/**
 * A glyph beside each mode.
 *
 * DECORATION ONLY, AND EQUAL BY CONSTRUCTION. `Icon` is `aria-hidden` by design, so none of
 * these adds or subtracts meaning; each mode gets exactly one, at one size, so the three read
 * as three choices rather than one choice and two consolations. The word carries the meaning.
 */
const MODE_ICON = {
  video: 'users',
  voice: 'phone',
  chat: 'mail',
} as const
