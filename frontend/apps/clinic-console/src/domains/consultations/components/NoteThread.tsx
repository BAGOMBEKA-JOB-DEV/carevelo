import { Badge, Button, DateTime, Field, Icon, Textarea } from '@carevelo/ui'
import { NOTE_SECTIONS, SECTION_LABEL, isNoteSection, type NoteSection } from '../model/drafts'
import type { ClinicalNote } from '../model/types'

/**
 * WHAT IS ACTUALLY ON THE RECORD, AND HOW A CORRECTION IS MADE.
 *
 * ====================================================================================
 * THERE IS NO DELETE CONTROL HERE, AND THERE IS NO DISABLED ONE EITHER
 * ====================================================================================
 *
 * `ClinicalNoteController` has an index, a store and an addendum. The absence of a fourth is
 * the design: "A note is corrected by adding an addendum that supersedes it; the original stays
 * readable forever. A medical record that can be silently rewritten is not a medical record."
 *
 * So this component renders no bin, no "edit", and no greyed-out affordance. A greyed-out
 * delete is WORSE than nothing: it teaches a clinician that deletion is a thing that happens
 * in this product and that somebody merely has not been given permission for it. The
 * capability does not exist. The screen reads as though it never did.
 *
 * ====================================================================================
 * WHY THERE ARE SO MANY ENTRIES PER SECTION, AND WHY THEY ARE ALL SHOWN
 * ====================================================================================
 *
 * Every debounced sync appends a row — the endpoint says so: "Each save is a new row rather
 * than an overwrite, because the model forbids overwriting a body at all." A ten-minute
 * consultation with a five-second debounce leaves a handful of successive part-written
 * versions of the same section in the record.
 *
 * The honest presentation is the one below: the NEWEST entry in each section is shown as the
 * text, and every earlier one is behind a disclosure that says plainly why it is still there.
 * Hiding them entirely would be a screen quietly deciding which parts of a clinical record a
 * clinician is allowed to see; listing them all inline would bury the note under its own
 * autosaves.
 *
 * ADDENDA ARE NOT AUTOSAVES AND ARE NEVER COLLAPSED. An addendum is a deliberate correction
 * with `supersedes_note_id` set, and it is rendered at full weight against the entry it
 * supersedes, because the whole value of the mechanism is that both remain readable.
 */
export function NoteThread({
  notes,
  addendumAction,
}: {
  notes: readonly ClinicalNote[]
  /** Bound by the room: posts `note_id` and `body`. */
  addendumAction: (formData: FormData) => Promise<void>
}) {
  const addenda = notes.filter((note) => note.supersedes_note_id !== null)

  return (
    <section className="card stack" style={{ gap: 'var(--space-6)' }} aria-labelledby="record-heading">
      <div className="stack">
        <h2 id="record-heading" className="title-sm">
          On the record
        </h2>
        <p className="fine">
          Everything saved to this consultation, oldest first within each section. Nothing here
          can be edited or removed — a correction is an addendum, which is added below and sits
          alongside what it corrects.
        </p>
      </div>

      {notes.length === 0 ? (
        <p className="muted">Nothing has been saved to this consultation yet.</p>
      ) : null}

      {NOTE_SECTIONS.map((section) => {
        const entries = notes.filter((note) => note.note_type === section)

        if (entries.length === 0) {
          return null
        }

        const current = entries[entries.length - 1]
        const earlier = entries.slice(0, -1)

        if (current === undefined) {
          return null
        }

        return (
          <SectionRecord
            key={section}
            section={section}
            current={current}
            earlier={earlier}
            addenda={addenda.filter((note) => note.supersedes_note_id === current.id)}
            addendumAction={addendumAction}
          />
        )
      })}

      {/*
        * Addenda whose superseded note is not the CURRENT entry of its section — because the
        * section was written again afterwards, or because the note was an addendum itself.
        * They still belong on the screen: an addendum that is not rendered anywhere is a
        * correction the next reader never sees.
        */}
      {addenda
        .filter((note) => !isAttachedAbove(note, notes))
        .map((note) => (
          <Entry key={note.id} note={note} tone="addendum" />
        ))}
    </section>
  )
}

function SectionRecord({
  section,
  current,
  earlier,
  addenda,
  addendumAction,
}: {
  section: NoteSection
  current: ClinicalNote
  earlier: readonly ClinicalNote[]
  addenda: readonly ClinicalNote[]
  addendumAction: (formData: FormData) => Promise<void>
}) {
  return (
    <div className="stack" style={{ gap: 'var(--space-4)' }}>
      <h3 className="eyebrow">{SECTION_LABEL[section]}</h3>

      <Entry note={current} tone="current" />

      {addenda.map((note) => (
        <Entry key={note.id} note={note} tone="addendum" />
      ))}

      {earlier.length > 0 ? (
        <details>
          <summary className="lnk" style={{ minHeight: 'var(--touch-min)', display: 'inline-flex', alignItems: 'center' }}>
            {earlier.length} earlier {earlier.length === 1 ? 'save' : 'saves'} of this section
          </summary>

          <p className="fine" style={{ marginTop: 'var(--space-3)' }}>
            These are the part-written versions saved automatically while the note was being
            typed. They are kept because nothing in a clinical record is ever removed, not
            because anybody needs to read them.
          </p>

          <div className="stack" style={{ gap: 'var(--space-3)', marginTop: 'var(--space-3)' }}>
            {earlier.map((note) => (
              <Entry key={note.id} note={note} tone="earlier" />
            ))}
          </div>
        </details>
      ) : null}

      {/*
        * THE ONLY CORRECTION MECHANISM IN THE PRODUCT, and it is attached to the entry it
        * corrects rather than floating at the bottom of the screen. A `<details>` because the
        * ordinary case is not correcting anything, and because a disclosure works with no
        * JavaScript at all.
        */}
      <details>
        <summary className="lnk" style={{ minHeight: 'var(--touch-min)', display: 'inline-flex', alignItems: 'center' }}>
          <Icon name="file" /> Add an addendum to this section
        </summary>

        <form action={addendumAction} className="stack" style={{ gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
          <input type="hidden" name="note_id" value={current.id} />

          <Field
            name={`addendum-${current.id}`}
            label="What needs correcting or adding?"
            hint="This is added to the record as a new entry that supersedes the one above. The original stays exactly as it is and stays readable — that is what makes the correction trustworthy."
          >
            {(control) => <Textarea {...control} name="body" required rows={3} />}
          </Field>

          <div>
            <Button variant="primary" type="submit">
              Add addendum
            </Button>
          </div>
        </form>
      </details>
    </div>
  )
}

function Entry({
  note,
  tone,
}: {
  note: ClinicalNote
  tone: 'current' | 'earlier' | 'addendum'
}) {
  return (
    <article
      className={tone === 'current' ? 'card card-tight stack' : 'stack'}
      style={{ gap: 'var(--space-2)' }}
    >
      <div className="row-wrap" style={{ gap: 'var(--space-3)' }}>
        {tone === 'addendum' ? <Badge tone="info">Addendum</Badge> : null}
        {tone === 'earlier' ? <Badge tone="neutral">Earlier save</Badge> : null}
        {!isNoteSection(note.note_type) && tone !== 'addendum' ? (
          <Badge tone="neutral">{note.note_type}</Badge>
        ) : null}
        <span className="fine">
          {note.created_at === null ? (
            'Time not recorded'
          ) : (
            <DateTime value={note.created_at} format="datetime" />
          )}
        </span>
      </div>

      {/* `pre` with wrapping, not a paragraph: a clinician's line breaks are part of what they
          wrote, and collapsing them changes the note. */}
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          fontFamily: 'inherit',
          fontSize: tone === 'earlier' ? 13 : 15,
          color: tone === 'earlier' ? 'var(--ink-muted)' : 'var(--ink)',
          margin: 0,
        }}
      >
        {note.body}
      </pre>
    </article>
  )
}

/** Was this addendum already drawn under the current entry of some section? */
function isAttachedAbove(addendum: ClinicalNote, notes: readonly ClinicalNote[]): boolean {
  return NOTE_SECTIONS.some((section) => {
    const entries = notes.filter((note) => note.note_type === section)
    const current = entries[entries.length - 1]

    return current !== undefined && current.id === addendum.supersedes_note_id
  })
}
