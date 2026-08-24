import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import {
  Badge,
  Button,
  Choice,
  DateTime,
  EmptyState,
  Icon,
  Inline,
  Notice,
  PageHeader,
  Stack,
  type ChoiceOption,
} from '@carevelo/ui'
import { addAddendum } from '../api/notes'
import { endConsultation, recordMode, roomSignature, startConsultation } from '../api/consultations'
import { enterRoom } from '../api/room'
import type { RoomState } from '../api/entry'
import { NOTE_SECTIONS, type NoteSection } from '../model/drafts'
import {
  asMode,
  asOutcome,
  isRemoteMode,
  MODE_LABEL,
  OUTCOME_LABEL,
  type ClinicalNote,
  type ConsultationOutcome,
  type ConsultationPaths,
  type Patient,
} from '../model/types'
import type { SectionSeed } from './NoteEditor'
import { EndConsultation } from './EndConsultation'
import { MediaPane } from './MediaPane'
import { ModeControl } from './ModeControl'
import { NoteEditor } from './NoteEditor'
import { NoteThread } from './NoteThread'
import { PatientHistory } from './PatientHistory'
import { RoomLive } from './RoomLive'

/**
 * THE CLINICIAN CONSULTATION ROOM — the hardest screen in the product and the one most likely
 * to lose a clinician.
 *
 * ====================================================================================
 * ONE SCREEN, ONE COLUMN, MOBILE FIRST
 * ====================================================================================
 *
 * "Ronald works between rooms on a phone. If prescribing is not comfortable one-handed on a
 * phone, it will not be used." Everything below follows from that.
 *
 * ONE COLUMN, ALWAYS, and this is a decision rather than an omission. A two-column desktop
 * layout is the obvious thing to reach for and it is wrong here: it puts the note editor and
 * the prescribing form at different heights on a phone depending on how much history the
 * patient has, and it makes the DOM order — which is what a screen reader and a thumb both
 * follow — different from the visual order. One column means the order on the screen IS the
 * order of the work, on every device, for every reader.
 *
 * THE ORDER IS THE ORDER OF THE CONSULTATION:
 *
 *   who am I seeing → how am I seeing them → what did they say → what have they been seen for
 *   → what is on the record → what am I prescribing → how did this end
 *
 * The note editor sits above the fold on a phone, because it is the control used every few
 * seconds for the whole encounter. The history sits below it because it is read once. Ending
 * is last because it is irreversible and should take a deliberate scroll to reach.
 *
 * ====================================================================================
 * WHAT THIS COMPONENT DOES NOT DO
 * ====================================================================================
 *
 * It does not render the prescribing form. That belongs to the prescriptions domain, and
 * composing two domains is the ROUTE's job — `.dependency-cruiser.cjs` enforces the direction.
 * The route passes it in as `prescribing`, and this component decides only WHERE it goes.
 *
 * It holds no state and ships no JavaScript of its own. The two client components on the page
 * are the note editor, which needs local storage and a debounce, and the freshness poller.
 * Every other control is a native form post to a server action closed over what the server
 * rendered with.
 */

export type ConsultationRoomProps = {
  state: RoomState
  paths: ConsultationPaths
  /** The signed-in clinician's user id. Scopes the note draft's local storage key. */
  userId: string
  /** The clinic's telephone number, for the honest fallback while video is unconfigured. */
  clinicPhone?: string | null | undefined
  /**
   * The prescriptions domain's panel, composed in by the route.
   *
   * Passed as a node rather than fetched here, because a domain may not reach into another
   * domain and because the panel needs facts — the prescriber's registration details — that
   * only that domain knows how to obtain.
   */
  prescribing?: ReactNode | undefined
  /** `?problem=` and `?message=`, handed back by the actions below. */
  problem?: string | undefined
  message?: string | undefined
}

export function ConsultationRoom({
  state,
  paths,
  userId,
  clinicPhone,
  prescribing,
  problem,
  message,
}: ConsultationRoomProps) {
  if (state.kind === 'unavailable') {
    /*
     * A 404 and a 403 are the same answer here and the screen must not draw the distinction
     * back out. A 403 would confirm the appointment exists somewhere, which is how you learn
     * that a named person is a patient of another clinic.
     */
    return (
      <EmptyState
        icon="help"
        title="That appointment is not available"
        action={
          <Button variant="primary" href={paths.day}>
            Back to the schedule
          </Button>
        }
      >
        It could not be read. It may not belong to this clinic.
      </EmptyState>
    )
  }

  if (state.kind === 'closed') {
    return (
      <>
        <RoomHead patient={state.patient} start={state.appointment.scheduled_start_at} reference={state.appointment.reference} />
        <Notice tone="warn" icon="lock" title={CLOSED_TITLE[state.reason]}>
          {CLOSED_BODY[state.reason]}
        </Notice>
        <p style={{ marginTop: 'var(--space-5)' }}>
          <Button variant="quiet" href={paths.day}>
            Back to the schedule
          </Button>
        </p>
      </>
    )
  }

  const appointmentId = state.appointment.id
  const patientId = state.appointment.patient_id
  const back = (params: Record<string, string | undefined> = {}) => {
    const search = new URLSearchParams()

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        search.set(key, value)
      }
    }

    const query = search.toString()

    return query === '' ? paths.room(appointmentId) : `${paths.room(appointmentId)}?${query}`
  }

  /**
   * Go in: start the encounter, then spend a token on the door.
   *
   * IN THAT ORDER, AND THE ORDER MATTERS. `assertJoinable` admits `confirmed` and
   * `in_progress`; starting the consultation is what moves the appointment to `in_progress`.
   * Doing it the other way round works too, but this way a clinician whose token issue fails
   * still has a started consultation with a note editor, which is the half that cannot be
   * done by telephone instead.
   *
   * THE MODE IS OPTIONAL AND ASKED FOR AT THE DOOR ON PURPOSE. A clinician who already knows
   * the patient's connection will not carry video says so before the attempt rather than
   * after a failed one, and the booked mode is left alone as the record of what was agreed.
   */
  async function join(formData: FormData) {
    'use server'

    const requested = String(formData.get('mode') ?? '')
    const mode = isRemoteMode(requested) ? requested : undefined

    if (state.kind === 'door' && state.consultation === null) {
      const started = await startConsultation(appointmentId, mode)

      if (started.kind === 'problem') {
        return redirect(back({ problem: 'start', message: started.message ?? undefined }))
      }
    }

    const entry = await enterRoom(appointmentId)

    if (!entry.ok) {
      return redirect(back({ problem: classify(entry.status) }))
    }

    return redirect(back())
  }

  async function changeMode(formData: FormData) {
    'use server'

    const consultationId = currentConsultationId(state)
    const requested = String(formData.get('mode') ?? '')

    if (consultationId === null || !isRemoteMode(requested)) {
      return redirect(back({ problem: 'incomplete' }))
    }

    const result = await recordMode(consultationId, requested)

    if (result.kind === 'problem') {
      return redirect(back({ problem: 'mode', message: result.message ?? undefined }))
    }

    return redirect(back())
  }

  async function end(formData: FormData) {
    'use server'

    const consultationId = currentConsultationId(state)
    const outcome = String(formData.get('outcome') ?? '')

    if (consultationId === null || !isOutcome(outcome)) {
      return redirect(back({ problem: 'incomplete' }))
    }

    const result = await endConsultation(consultationId, outcome)

    if (result.kind === 'problem') {
      return redirect(back({ problem: 'end', message: result.message ?? undefined }))
    }

    /*
     * No confirmation parameter. The head badge says "Ended · <outcome>" and the prescribing
     * panel changes shape — the page states the new fact rather than carrying a message about
     * it, which also means a reload does not re-announce something that happened once.
     */
    return redirect(back())
  }

  async function addendum(formData: FormData) {
    'use server'

    const consultationId = currentConsultationId(state)
    const noteId = String(formData.get('note_id') ?? '').trim()
    const body = String(formData.get('body') ?? '')

    if (consultationId === null || noteId === '' || body.trim() === '') {
      return redirect(back({ problem: 'incomplete' }))
    }

    const result = await addAddendum(consultationId, noteId, body)

    if (result.kind !== 'saved') {
      return redirect(back({ problem: 'addendum', message: messageOf(result) }))
    }

    return redirect(back())
  }

  if (state.kind === 'door') {
    return (
      <>
        <RoomHead
          patient={state.patient}
          start={state.appointment.scheduled_start_at}
          reference={state.appointment.reference}
        />
        <Problem problem={problem} message={message} />

        <Stack gap="5">
          <section className="card stack" style={{ gap: 'var(--space-5)' }} aria-labelledby="door-heading">
            <h2 id="door-heading" className="title-sm">
              {state.consultation === null ? 'Start this consultation' : 'Rejoin this consultation'}
            </h2>

            <p className="muted">
              {state.consultation === null
                ? 'Starting records that you joined and opens the note. The patient sees that you have arrived.'
                : 'This consultation is already under way. Rejoining spends a fresh pass on the door; nothing about the record changes.'}
            </p>

            <form action={join} className="stack" style={{ gap: 'var(--space-5)' }}>
              {state.consultation === null ? (
                <Choice
                  name="mode"
                  legend="How will you hold it?"
                  required
                  defaultValue={defaultMode(state.bookedMode)}
                  options={MODE_OPTIONS}
                  hint={
                    state.bookedMode === null
                      ? 'Recorded as what actually happens, which is what the patient is shown.'
                      : `Booked as ${MODE_LABEL[state.bookedMode].toLowerCase()}. If you already know that will not work, say so now rather than after a failed attempt — the booking is left alone as the record of what was agreed.`
                  }
                />
              ) : null}

              <div>
                <Button variant="primary" size="lg" type="submit">
                  <Icon name="activity" /> {state.consultation === null ? 'Start and go in' : 'Rejoin'}
                </Button>
              </div>
            </form>

            <p className="fine">
              Going in is a single-use pass, which is why it is a button and not a link — a
              refresh or a back button would otherwise spend one and lock you out of your own
              consultation. If you lose the tab, come back here and press it again.
            </p>
          </section>

          <PatientHistory patient={state.patient} history={state.history} />
        </Stack>
      </>
    )
  }

  const consultation = state.consultation
  const used = consultation === null ? null : asMode(consultation.mode_used)
  const outcome = consultation === null ? null : asOutcome(consultation.outcome)
  const ended = consultation !== null && consultation.ended_at !== null

  return (
    <>
      <RoomHead
        patient={state.patient}
        start={state.appointment.scheduled_start_at}
        reference={state.appointment.reference}
        mode={used}
        ended={ended}
        outcome={outcome}
      />
      <Problem problem={problem} message={message} />

      <Stack gap="5">
        {state.credentials !== null ? (
          <MediaPane credentials={state.credentials} mode={used} clinicPhone={clinicPhone} />
        ) : (
          /*
           * NO ROOM, AND THAT IS CORRECT RATHER THAN BROKEN. The encounter is over, so
           * `assertJoinable` would refuse a fresh pass — and there is nothing to be in. What is
           * left is the record, which is the screen a clinician needs to add an addendum or to
           * issue the prescription that only a completed consultation can carry.
           */
          <Notice tone="neutral" icon="file" title="You are reading the record" announce={false}>
            This consultation has ended. There is no room to go back into. You can still add an
            addendum to any note, and — if it ended as completed — issue a prescription against
            it.
          </Notice>
        )}

        {consultation === null ? (
          /*
           * Credentials in hand and no consultation on the record. Rare, and it happens: the
           * token was spent and the start call failed, or a colleague's browser opened the
           * door first. Saying so beats a room with a note editor that cannot save.
           */
          <Notice tone="bad" title="No consultation record for this appointment">
            You are in the room, but nothing has been recorded as started — so there is nowhere
            to write a note. Go back to the schedule and open this appointment again.
          </Notice>
        ) : (
          <>
            {!ended ? (
              <ModeControl consultation={consultation} bookedMode={state.bookedMode} action={changeMode} />
            ) : null}

            <section className="card stack" style={{ gap: 'var(--space-5)' }} aria-labelledby="note-heading">
              <div className="stack">
                <h2 id="note-heading" className="title-sm">
                  The note
                </h2>
                <p className="fine">
                  Kept on this device as you type and sent to the clinic&rsquo;s record every
                  few seconds. A dropped connection loses nothing.
                </p>
              </div>

              <NoteEditor
                consultationId={consultation.id}
                userId={userId}
                seeds={seedSections(state.notes)}
                closed={ended}
              />
            </section>

            <PatientHistory patient={state.patient} history={state.history} />

            <NoteThread notes={state.notes} addendumAction={addendum} />

            {prescribing}

            {!ended ? <EndConsultation action={end} notesSaved={state.notes.length > 0} /> : null}

            <RoomLive
              appointmentId={appointmentId}
              patientId={patientId}
              signature={roomSignature(consultation, state.notes.length)}
              hasEnded={ended}
            />
          </>
        )}
      </Stack>
    </>
  )
}

/** Who, when, and what state the encounter is in. The first thing on the screen, always. */
function RoomHead({
  patient,
  start,
  reference,
  mode,
  ended,
  outcome,
}: {
  patient: Patient | null
  start: string
  reference: string
  mode?: ReturnType<typeof asMode> | undefined
  ended?: boolean | undefined
  outcome?: ConsultationOutcome | null | undefined
}) {
  return (
    <PageHeader
      title={
        patient === null
            ? 'Patient record unavailable'
          : `${patient.given_name} ${patient.family_name}`
      }
      description={
          <>
          <DateTime value={start} format="datetime" /> · <span className="mono">{reference}</span>
          </>
      }
      actions={
          <Inline gap="3">
          {mode ? <Badge tone="info">{MODE_LABEL[mode]}</Badge> : null}
          {ended ? (
          <Badge tone={outcome === 'completed' ? 'good' : 'neutral'}>
            Ended{outcome ? ` · ${OUTCOME_LABEL[outcome]}` : null}
          </Badge>
          ) : null}
          </Inline>
      }
    />
  )
}

/**
 * The newest note the server holds in each section, which is what the editor starts from.
 *
 * THE NEWEST AND NOT A CONCATENATION. Every debounced sync appends a row, so a section has
 * several successive versions of itself in the record; the last one is the whole text as it
 * stood at the last save, not a fragment. Joining them would show the clinician their own
 * sentence four times.
 */
function seedSections(notes: readonly ClinicalNote[]): Record<NoteSection, SectionSeed> {
  const seeds = {} as Record<NoteSection, SectionSeed>

  for (const section of NOTE_SECTIONS) {
    const entries = notes.filter(
      (note) => note.note_type === section && note.supersedes_note_id === null,
    )
    const newest = entries[entries.length - 1]

    seeds[section] = { body: newest?.body ?? '', noteId: newest?.id ?? null }
  }

  return seeds
}

/** The consultation currently on the record, for the actions. Null means there is nothing to act on. */
function currentConsultationId(state: RoomState): string | null {
  if (state.kind === 'door' || state.kind === 'open') {
    return state.consultation?.id ?? null
  }

  return null
}

const MODE_OPTIONS: ChoiceOption[] = [
  { value: 'video', label: 'Video', note: 'Needs a usable data connection at both ends.' },
  { value: 'voice', label: 'Voice', note: 'Works on any handset and on a weak connection.' },
  { value: 'chat', label: 'Chat', note: 'Text only. Useful where a call is not private or not affordable.' },
]

/** The booked mode, unless it was in-person — which is not a mode a remote room can be held in. */
function defaultMode(booked: ReturnType<typeof asMode>): string {
  return booked !== null && isRemoteMode(booked) ? booked : 'video'
}

const CLOSED_TITLE: Record<'not-confirmed' | 'cancelled' | 'finished', string> = {
  'not-confirmed': 'This appointment is not confirmed',
  cancelled: 'This appointment will not take place',
  finished: 'This appointment is over',
}

const CLOSED_BODY: Record<'not-confirmed' | 'cancelled' | 'finished', string> = {
  'not-confirmed':
    'The patient has not paid and the slot is only being held. A consultation cannot be '
    + 'started against it. An administrator can confirm it on the clinic’s authority from the '
    + 'schedule if the patient will settle at the desk.',
  cancelled:
    'It was cancelled, missed, or its hold expired. There is no room for it and there will not '
    + 'be one — book the patient again from the schedule.',
  finished:
    'It closed without a consultation being recorded, so there is no record here to open.',
}

/** Which sentence a failed entry deserves. A CLOSED SET, and the API's own message is not forwarded. */
function classify(status: number): string {
  if (status === 403 || status === 404) {
    return 'refused'
  }

  // 419 is Laravel's expired CSRF token, which presents as exactly what it is: the session
  // went stale while the page sat open in a consulting room.
  if (status === 401 || status === 419) {
    return 'session'
  }

  return 'entry'
}

function isOutcome(value: string): value is ConsultationOutcome {
  return asOutcome(value) !== null
}

function messageOf(result: { kind: 'problem'; message: string | null } | { kind: string }): string | undefined {
  return 'message' in result && typeof result.message === 'string' ? result.message : undefined
}

/**
 * What went wrong with the last action.
 *
 * `message` IS THE API'S OWN SENTENCE and travels through the query string, which is written
 * by whoever sends the link. It is rendered as TEXT and never as markup, and the codes are a
 * closed set — so the worst a crafted URL achieves is a stranger's sentence in a box. The
 * codes decide the shape of the response; the message only fills in the detail.
 */
function Problem({ problem, message }: { problem: string | undefined; message: string | undefined }) {
  if (problem === undefined || problem === '') {
    return null
  }

  if (problem === 'refused') {
    return (
      <Notice tone="warn" icon="lock" title="You cannot enter this consultation">
        Only the clinician holding it and the patient may go in — an administrator can read that
        it happened but cannot sit in on it. If this is your appointment, check that your
        account is linked to a clinician record at this clinic.
      </Notice>
    )
  }

  if (problem === 'session') {
    return (
      <Notice tone="warn" icon="clock" title="Your session went stale">
        The console signed you out while this page sat open — staff sessions time out after
        twenty minutes idle. Sign in again and come straight back; nothing has been lost.
      </Notice>
    )
  }

  if (problem === 'incomplete') {
    return (
      <Notice tone="warn" title="Nothing was changed">
        The form arrived without everything it needs. Nothing has been written to the record.
      </Notice>
    )
  }

  return (
    <Notice tone="bad" title="That did not go through">
      {message && message !== ''
        ? message
        : 'The clinic’s server refused it and gave no reason this screen can pass on. Nothing '
          + 'was written to the record.'}
    </Notice>
  )
}
