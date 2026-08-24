'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, DateTime, Grid, Inline, Notice, Stack, Textarea } from '@carevelo/ui'
import { saveNoteSection } from '../api/actions'
import {
  draftKey,
  NOTE_SECTIONS,
  SECTION_HINT,
  SECTION_LABEL,
  SYNC_DEBOUNCE_MS,
  type NoteSection,
  type StoredDraft,
} from '../model/drafts'

/**
 * THE SOAP NOTE EDITOR — and the reason this is the only substantial client component in the
 * console.
 *
 * ====================================================================================
 * 'use client' IS EARNED HERE BY A HARD REQUIREMENT, NOT BY CONVENIENCE
 * ====================================================================================
 *
 * docs/30-architecture/frontend-nextjs.md:132 — "Draft notes persist to local storage as they
 * are typed and sync to the API on a debounce. A dropped connection loses nothing; on
 * reconnect, the local draft is reconciled with the server and any conflict is shown rather
 * than silently resolved. This is a hard requirement, not an optimisation."
 *
 * Persisting on every keystroke needs a keystroke handler. A debounce needs a timer. Reading
 * back what was persisted needs `localStorage`. None of those exist on a server, so this
 * component is a client component, and everything else in this room is not.
 *
 * ====================================================================================
 * THE ORDER OF OPERATIONS, WHICH IS THE WHOLE DESIGN
 * ====================================================================================
 *
 *   1. The clinician types. The text is written to `localStorage` SYNCHRONOUSLY, in the same
 *      tick. Not after a debounce, not after a render — immediately. If the tab dies half a
 *      second later, nothing is lost.
 *   2. A timer is set. Five seconds of quiet later, the text is sent to the API. Blur, and
 *      the tab being hidden, flush it early. See SYNC_DEBOUNCE_MS for why five and not one:
 *      every sync appends a permanent, undeletable row to a clinical record.
 *   3. If the sync succeeds, the local copy is DELETED. That is acceptance criterion 7 — no
 *      clinical data in client storage beyond the ACTIVE draft — and the draft stops being
 *      active the moment the server has it.
 *   4. If the sync fails, the local copy stays and the status line says so, in words, with a
 *      manual retry beside it. It never says "saved" when it is not.
 *   5. If the server has moved underneath us, BOTH TEXTS ARE SHOWN and the clinician chooses.
 *      Never merged, never last-write-wins. It is a clinical record.
 *
 * ====================================================================================
 * WHAT THIS COMPONENT WILL NOT DO
 * ====================================================================================
 *
 * It will not resolve a conflict. It will not delete a note — the capability does not exist in
 * the API and no control here implies it does. It will not tell the clinician a section is
 * saved because the request was sent. And it will not silently swallow a storage failure: a
 * browser in private mode with site data blocked throws on `localStorage`, and a clinician
 * whose safety net is missing is told that it is missing rather than left believing in it.
 */

export type SectionSeed = {
  /** The newest note the server holds in this section, or empty. */
  body: string
  noteId: string | null
}

export type NoteEditorProps = {
  consultationId: string
  /** Scopes the storage key, so a second clinician on a shared handset finds their own empty editor. */
  userId: string
  seeds: Record<NoteSection, SectionSeed>
  /**
   * The encounter has ended. Notes may still be appended — `ClinicalNoteController::store`
   * has no in-progress check, deliberately, because a clinician who was still typing when they
   * pressed End must not lose it — but the framing changes and the screen says so.
   */
  closed: boolean
}

export function NoteEditor({ consultationId, userId, seeds, closed }: NoteEditorProps) {
  const [storageBroken, setStorageBroken] = useState(false)

  useEffect(() => {
    setStorageBroken(!storageWorks())
  }, [])

  return (
    <Stack gap="6">
      {storageBroken ? (
        <Notice tone="warn" icon="shield" title="This browser is not keeping a local copy">
          Private browsing, or a setting that blocks site data, stops the draft being saved on
          this device. Your notes are still sent to the clinic&rsquo;s record every few seconds
          — but if the connection drops, anything typed since the last save will be lost.
          Save each section before you move on.
        </Notice>
      ) : null}

      {closed ? (
        <Notice tone="info" icon="lock" title="This encounter is closed" announce={false}>
          The consultation has ended. You can still finish a section you were part-way through,
          and anything added now joins the record as a later entry — it does not replace what is
          already there. To correct something already written, add an addendum to it below.
        </Notice>
      ) : null}

      {NOTE_SECTIONS.map((section) => (
        <SectionEditor
          key={section}
          section={section}
          consultationId={consultationId}
          userId={userId}
          seed={seeds[section]}
        />
      ))}
    </Stack>
  )
}

type Status =
  /** Nothing typed and nothing on the record. Distinct from `clean`, which claims a save. */
  | { kind: 'empty' }
  | { kind: 'clean' }
  | { kind: 'unsaved' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: number }
  | { kind: 'failed'; message: string }
  | { kind: 'conflict'; theirs: string; theirsAt: string | null }

function SectionEditor({
  section,
  consultationId,
  userId,
  seed,
}: {
  section: NoteSection
  consultationId: string
  userId: string
  seed: SectionSeed
}) {
  const key = draftKey(userId, consultationId, section)

  const [body, setBody] = useState(seed.body)
  /*
   * `empty` and `clean` are deliberately different opening states. A section the clinician has
   * not touched, in a consultation with nothing on the record, must not say "Saved to the
   * clinic's record" — that is a claim about a note that does not exist, and it is exactly the
   * claim this component must never make.
   */
  const [status, setStatus] = useState<Status>(
    seed.noteId === null && seed.body === '' ? { kind: 'empty' } : { kind: 'clean' },
  )

  /*
   * REFS, NOT STATE, for the two values the save path reads.
   *
   * A debounced save fires from a timer that closed over whatever the render at the time was
   * holding. With state, the callback would send the text as it was five seconds ago; with a
   * ref it sends what is in the box now. The same applies to the synced baseline, which the
   * conflict check compares against and which changes on every successful save.
   */
  const latest = useRef(seed.body)
  const baseNoteId = useRef<string | null>(seed.noteId)
  const syncedBody = useRef(seed.body)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const persist = useCallback(
    (value: string) => {
      const draft: StoredDraft = {
        body: value,
        syncedBody: syncedBody.current,
        syncedNoteId: baseNoteId.current,
        changedAt: Date.now(),
      }

      try {
        window.localStorage.setItem(key, JSON.stringify(draft))
      } catch {
        // Reported once, at the top of the editor, by the storage probe. Swallowed here on
        // purpose: throwing out of a keystroke handler would take the editor down, and the
        // network sync is still running.
      }
    },
    [key],
  )

  const forget = useCallback(() => {
    try {
      window.localStorage.removeItem(key)
    } catch {
      // Nothing to do. If storage is unavailable there is nothing stored to remove.
    }
  }, [key])

  const send = useCallback(
    async (force: boolean) => {
      const value = latest.current

      if (value.trim() === '' || value === syncedBody.current) {
        // Nothing to say, or nothing new to say. A no-op save would append a duplicate row to
        // a record where nothing can ever be removed.
        setStatus(baseNoteId.current === null ? { kind: 'empty' } : { kind: 'clean' })

        return
      }

      setStatus({ kind: 'saving' })

      try {
        const result = await saveNoteSection({
          consultationId,
          section,
          body: value,
          baseNoteId: baseNoteId.current,
          force,
        })

        if (result.kind === 'saved') {
          baseNoteId.current = result.note.id
          syncedBody.current = result.note.body
          // AC 7: the draft is no longer active, so it leaves client storage.
          forget()
          setStatus({ kind: 'saved', at: Date.now() })

          return
        }

        if (result.kind === 'conflict') {
          // The local copy STAYS. It is the only thing standing between the clinician and
          // losing what they wrote while they decide.
          persist(value)
          setStatus({
            kind: 'conflict',
            theirs: result.theirs.body,
            theirsAt: result.theirs.created_at,
          })

          return
        }

        persist(value)
        setStatus({
          kind: 'failed',
          message: result.message ?? 'The clinic’s server did not accept it.',
        })
      } catch {
        /*
         * The dropped connection this whole design is written for. The local copy is already
         * on disk and stays there; the status says so honestly rather than claiming a save.
         */
        persist(value)
        setStatus({
          kind: 'failed',
          message: 'No connection to the clinic’s server. This section is saved on this device only.',
        })
      }
    },
    [consultationId, section, forget, persist],
  )

  const schedule = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
    }

    timer.current = setTimeout(() => void send(false), SYNC_DEBOUNCE_MS)
  }, [send])

  const flush = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }

    void send(false)
  }, [send])

  /*
   * RECONCILE ON MOUNT — the "on reconnect" half of the requirement.
   *
   * The page has just been server-rendered, so `seed` is what the API holds RIGHT NOW. The
   * local draft is what this device holds. Four cases, and only the last is a conflict:
   *
   *   - no local draft: the server's copy is the truth. Nothing to do.
   *   - local draft whose text equals the server's: they agree. Clear the local copy; it is no
   *     longer protecting anything.
   *   - local draft whose baseline is the server's newest note: this device is simply ahead —
   *     it typed and never managed to sync. Restore the text and mark it unsaved.
   *   - local draft whose baseline is NOT the server's newest note: something else wrote while
   *     this device was away. SHOW BOTH.
   */
  const reconciled = useRef(false)

  useEffect(() => {
    /*
     * GUARDED BY A REF RATHER THAN BY AN EMPTY DEPENDENCY LIST. Every value this reads is in
     * the list below, which is what the hooks rule asks for and what keeps it honest if the
     * seed ever becomes a changing prop. The ref is what makes it run once: re-running it
     * would restore a stale draft over text the clinician is in the middle of typing.
     */
    if (reconciled.current) {
      return
    }

    reconciled.current = true

    const stored = readStoredDraft(key)

    if (stored === null || typeof stored.body !== 'string' || stored.body === '') {
      return
    }

    if (stored.body === seed.body) {
      forget()

      return
    }

    setBody(stored.body)
    latest.current = stored.body

    if (stored.syncedNoteId === seed.noteId) {
      setStatus({ kind: 'unsaved' })

      return
    }

    setStatus({ kind: 'conflict', theirs: seed.body, theirsAt: null })
  }, [key, seed.body, seed.noteId, forget])

  /*
   * Flush before the page goes away, and when the tab is hidden.
   *
   * `pagehide` rather than `beforeunload`: the latter is unreliable on mobile Safari and on
   * Android Chrome, which are the browsers this console actually runs in. Neither is a
   * guarantee — a killed tab fires nothing — which is exactly why local storage is the
   * guarantee and this is only an optimisation on top of it.
   */
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') {
        flush()
      }
    }

    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', flush)

    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', flush)

      if (timer.current !== null) {
        clearTimeout(timer.current)
      }
    }
  }, [flush])

  const id = `note-${section}`

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {SECTION_LABEL[section]}
      </label>
      <p className="field__hint" id={`${id}-hint`}>
        {SECTION_HINT[section]}
      </p>

      <Textarea
        id={id}
        name={section}
        aria-describedby={`${id}-hint ${id}-status`}
        rows={4}
        value={body}
        onChange={(event) => {
          const value = event.target.value

          setBody(value)
          latest.current = value
          // Immediately, before anything else. See the header.
          persist(value)
          setStatus({ kind: 'unsaved' })
          schedule()
        }}
        onBlur={flush}
      />

      <StatusLine id={`${id}-status`} status={status} onRetry={flush} />

      {status.kind === 'conflict' ? (
        <ConflictPanel
          theirs={status.theirs}
          theirsAt={status.theirsAt}
          mine={body}
          onKeepMine={() => void send(true)}
          onTakeTheirs={() => {
            setBody(status.theirs)
            latest.current = status.theirs
            syncedBody.current = status.theirs
            forget()
            setStatus(status.theirs === '' ? { kind: 'empty' } : { kind: 'clean' })
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * What is actually true about this section right now, in words.
 *
 * NEVER A SPINNER ALONE AND NEVER A TICK THAT MEANS "SENT". A clinician needs to know whether
 * the clinic has this text or only this handset does, and the difference is the whole point of
 * the design. `aria-live="polite"` so a screen-reader user hears the transition without it
 * interrupting their typing.
 */
function StatusLine({
  id,
  status,
  onRetry,
}: {
  id: string
  status: Status
  onRetry: () => void
}) {
  return (
    <p className="fine" id={id} aria-live="polite">
      {status.kind === 'empty' ? 'Nothing written here yet.' : null}
      {status.kind === 'clean' ? 'Saved to the clinic’s record.' : null}
      {status.kind === 'unsaved' ? 'Saved on this device. Sending to the clinic shortly…' : null}
      {status.kind === 'saving' ? 'Sending to the clinic’s record…' : null}
      {status.kind === 'saved' ? 'Saved to the clinic’s record.' : null}
      {status.kind === 'conflict' ? 'Not saved — this section was also written elsewhere.' : null}
      {status.kind === 'failed' ? (
        <>
          <span className="note-bad">
            Not saved to the clinic. {status.message} Your text is safe on this device.
          </span>{' '}
          <button type="button" className="lnk" onClick={onRetry}>
            Try again now
          </button>
        </>
      ) : null}
    </p>
  )
}

/**
 * TWO VERSIONS OF THE SAME SECTION, SIDE BY SIDE, AND A HUMAN DECIDES.
 *
 * The requirement is one sentence and it is absolute: "any conflict is shown rather than
 * silently resolved". No merge, no last-write-wins, no "we kept the longer one".
 *
 * NOTHING IS LOST BY EITHER ANSWER, AND THE PANEL SAYS SO. Notes are append-only: the version
 * already on the server is immutable and stays there whatever is chosen here. "Keep mine as
 * well" appends a second entry; the record then honestly contains two accounts, which is what
 * actually happened. "Use theirs" discards only the local draft — the thing that was never in
 * the record in the first place — and even that only after the clinician has read both.
 *
 * THERE IS NO THIRD BUTTON. A "merge" control would be this component inventing a clinical
 * account that neither person wrote.
 */
function ConflictPanel({
  theirs,
  theirsAt,
  mine,
  onKeepMine,
  onTakeTheirs,
}: {
  theirs: string
  theirsAt: string | null
  mine: string
  onKeepMine: () => void
  onTakeTheirs: () => void
}) {
  return (
    <Notice tone="warn" icon="help" title="This section was written in two places">
      {/* `<Notice>` hands its children to a plain div with no gap, because most notices are
          one paragraph. This one is a paragraph, a two-column comparison and a pair of
          buttons, and each carried the same `marginTop` saying the space below the thing
          above it. One column, one step, stated once. */}
      <Stack gap="4">
        <p>
          The clinic&rsquo;s record already holds a version of this section that this device did
          not write — another tab, another device, or a colleague. Nothing has been overwritten
          and nothing can be: notes are only ever added to. Read both and decide.
        </p>

        <Grid cols={2}>
          <Stack gap="2">
            <span className="eyebrow">
              On the clinic&rsquo;s record
              {theirsAt === null ? null : (
                <>
                  {' · '}
                  <DateTime value={theirsAt} format="datetime" />
                </>
              )}
            </span>
            {/* `.verbatim` in console.css is exactly these three declarations — `pre-wrap`,
                the body face and a zeroed margin — written for a clinical note shown back to
                the person who wrote it, and used by nothing until now. A note's line breaks
                are part of what the clinician wrote; collapsing them changes the note, which
                is why the comparison the reader is about to make has to preserve them on both
                sides. `.card` still supplies the panel around it. */}
            <pre className="card verbatim">{theirs === '' ? '(empty)' : theirs}</pre>
          </Stack>

          <Stack gap="2">
            <span className="eyebrow">Typed on this device</span>
            <pre className="card verbatim">{mine === '' ? '(empty)' : mine}</pre>
          </Stack>
        </Grid>

        <Inline gap="3">
          <Button variant="primary" type="button" onClick={onKeepMine}>
            Add mine to the record as well
          </Button>
          <Button variant="quiet" type="button" onClick={onTakeTheirs}>
            Use the version already recorded
          </Button>
        </Inline>
      </Stack>
    </Notice>
  )
}

/**
 * The draft this browser is holding for one section, or null.
 *
 * A separate function rather than a try/catch inline, because storage throws in more ways than
 * one — blocked site data, a quota, a value written by an older version of this component —
 * and every one of them means the same thing here: there is no usable local copy, carry on
 * with what the server sent.
 */
function readStoredDraft(key: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(key)

    return raw === null ? null : (JSON.parse(raw) as StoredDraft)
  } catch {
    return null
  }
}

/** Does this browser let us keep a local copy at all? Probed once, reported once. */
function storageWorks(): boolean {
  try {
    const probe = '__carevelo_probe__'

    window.localStorage.setItem(probe, '1')
    window.localStorage.removeItem(probe)

    return true
  } catch {
    return false
  }
}
