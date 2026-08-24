import type { ReactElement, ReactNode } from 'react'
import { redirect } from 'next/navigation'
import {
  Badge,
  Button,
  Card,
  DataTable,
  DateTime,
  EmptyState,
  Icon,
  Notice,
  PageHeader,
  Stack,
} from '@carevelo/ui'
import { attempt } from '../api/http'
import { listPatients, mergePatient, tryReadPatient } from '../api/patients'
import type { Patient } from '../api/types'
import { statusDisplay } from '../model/status'
import type { PatientsPaths } from '../model/paths'

/**
 * Folding a duplicate registration into the record that survives.
 *
 * ==========================================================================
 * THE DIRECTION IS THE DANGEROUS PART, SO THE SCREEN IS BUILT AROUND SAYING IT.
 * ==========================================================================
 *
 * The record in the URL SURVIVES. The record chosen on this screen is folded into it and
 * afterwards points at it forever. `MergePatientRequest` puts them that way round on purpose —
 * the survivor is the record the desk already had open — and a caller who confuses the two
 * loses the wrong history in a way no validation can detect. There is no undo endpoint, no
 * "unmerge", and none is coming: the repointing is a single UPDATE across five tables and
 * nothing records which rows moved.
 *
 * So this is a two-step screen rather than a dropdown and a button. Choose, then look at both
 * records side by side with the surviving one marked, then confirm. The second step exists
 * only to be read.
 *
 * ==========================================================================
 * WHAT MERGING DOES NOT DO, AND WHY THE DESK MUST BE TOLD.
 * ==========================================================================
 *
 * THE SURVIVOR'S STATUS IS NOT RECALCULATED. If the duplicate was `active` and the survivor is
 * awaiting consent, the survivor stays awaiting consent — the desk confirms consent through
 * the consent screen, with the patient. `PatientController::merge` is explicit that silently
 * promoting a record because a DIFFERENT registration once consented is the one failure mode
 * here that ends with clinical data attached to a patient who never agreed to any of it. A
 * receptionist who expects the merge to "fix" the status will otherwise start booking against
 * a record that cannot hold a note.
 *
 * NOBODY IS DELETED. The duplicate row stays, pointing at the survivor, because the clinic may
 * be obliged to retain the medical record and a row that once carried a consent decision has to
 * stay explicable.
 *
 * WITHIN THIS CLINIC ONLY. There is no cross-tenant patient identity to merge onto, and there
 * will not be one — the isolation boundary between clinics is absolute. Row-level security
 * makes another clinic's identifier fail to resolve at all rather than this screen having to
 * remember to check.
 *
 * ==========================================================================
 * WHO MAY DO THIS.
 * ==========================================================================
 *
 * `PatientPolicy::merge` admits the administrator and the front desk, and deliberately NOT a
 * clinician: a clinician may correct a record but should not be repointing which record a
 * consultation belongs to, and the front desk is who creates the duplicates in the first
 * place. This console has no session surface yet, so the screen cannot grey the action out for
 * a clinician in advance — the API's 403 is the control, and it comes back as the API's own
 * sentence. See the handover note for the one field on `MeResource` that would let the UI say
 * it first.
 */

type MergeRoutes = {
  readonly survivorId: string
  readonly duplicateId: string
  /** This screen's own path, for a refused merge to come back to. */
  readonly returnHref: string
  /** The surviving record. Where a completed merge goes. */
  readonly recordHref: string
}

async function submitMerge(routes: MergeRoutes): Promise<void> {
  'use server'

  const result = await mergePatient(routes.survivorId, routes.duplicateId)

  if (!result.ok) {
    /*
     * The API's own sentence — "That duplicate has already been merged", "This record was itself
     * merged into another. Merge into the record that survived", "A record cannot be merged into
     * itself", and the flat 403 for a clinician who may not do this at all. Each says what to do
     * next; a paraphrase would have to guess which one fired.
     */
    const query = new URLSearchParams({
      duplicate: routes.duplicateId,
      error: result.message,
    })

    redirect(`${routes.returnHref}?${query.toString()}`)
  }

  redirect(`${routes.recordHref}?done=merged`)
}

export type MergeScreenProps = {
  paths: PatientsPaths
  /** The record that SURVIVES. Read by the route, so a foreign record is a 404 there. */
  survivor: Patient
  /** `?duplicate=` — the record chosen to be folded in. Absent on the first step. */
  duplicate?: string | undefined
  /** `?cursor=` — paging through the candidate list. */
  cursor?: string | undefined
  /** `?error=` — the API's sentence from a refused merge. */
  error?: string | undefined
}

export async function MergeScreen({
  paths,
  survivor,
  duplicate,
  cursor,
  error,
}: MergeScreenProps): Promise<ReactElement> {
  const returnHref = paths.merge(survivor.id)

  const heading = (
    <PageHeader
      title="Merge a duplicate"
      description={
        <>
          Into {survivor.given_name} {survivor.family_name} — the record that survives.
        </>
      }
      actions={
        <Button href={paths.record(survivor.id)} variant="quiet">
          Back to the record
        </Button>
      }
    />
  )

  /*
   * A record that was itself merged away cannot be a survivor. The API refuses it with "This
   * record was itself merged into another. Merge into the record that survived" — asking first
   * means the desk is not walked through choosing a duplicate before being told.
   */
  if (survivor.merged_into_patient_id !== null) {
    return (
      <>
        {heading}
        <Notice tone="warn" icon="users" announce title="This record was itself a duplicate">
          {/* A Notice's children land in a plain block, so the button under the sentence was
              being pushed down by a margin of its own. The column says it once. */}
          <Stack gap="4">
            <p>
              Its history already moved elsewhere, so nothing can be merged into it. Open the
              record that survived and merge from there.
            </p>
            <div>
              <Button href={paths.record(survivor.merged_into_patient_id)}>
                Open the record that survived
              </Button>
            </div>
          </Stack>
        </Notice>
      </>
    )
  }

  if (duplicate !== undefined && duplicate !== '') {
    return (
      <>
        {heading}
        <ConfirmStep
          paths={paths}
          survivor={survivor}
          duplicateId={duplicate}
          returnHref={returnHref}
          error={error}
        />
      </>
    )
  }

  return (
    <>
      {heading}
      <ChooseStep
        paths={paths}
        survivor={survivor}
        cursor={cursor}
        returnHref={returnHref}
        error={error}
      />
    </>
  )
}

/**
 * Step one: which record is the duplicate?
 *
 * THE SAME REGISTRY LIST, WITH THE SAME LIMITATION, AND IT IS STATED RATHER THAN HIDDEN.
 * `GET /v1/patients` filters on status and nothing else — there is no name or phone search to
 * call — so this is an alphabetical page of twenty-five with previous and next. On a register
 * of any size that means paging to the right letter, which is slow and is honest. A search box
 * here that examined only the loaded page would be worse than slow: the desk would conclude
 * there is no duplicate and leave a person split across two records.
 */
async function ChooseStep({
  paths,
  survivor,
  cursor,
  returnHref,
  error,
}: {
  paths: PatientsPaths
  survivor: Patient
  cursor: string | undefined
  returnHref: string
  error: string | undefined
}): Promise<ReactElement> {
  const page = await attempt(listPatients({ cursor: cursor === '' ? undefined : cursor }))

  /*
   * The survivor cannot be its own duplicate — `different:patient` refuses it with "A record
   * cannot be merged into itself". Filtering it out of the list means the desk never has the
   * option, which is better than a validation message about a choice they should not have been
   * offered. Records already merged away are absent from the API's list altogether.
   */
  const candidates = page.ok
    ? page.value.patients.filter((patient) => patient.id !== survivor.id)
    : []

  return (
    <div className="grid">
      {error !== undefined ? (
        <Notice tone="bad" announce title="Nothing was merged">
          {error}
        </Notice>
      ) : null}

      <Notice tone="warn" icon="shield" title="There is no way back from this">
        Everything on the record you choose — appointments, consultations, prescriptions,
        dispense orders and consent history — moves onto{' '}
        <strong>
          {survivor.given_name} {survivor.family_name}
        </strong>
        . The duplicate is kept, pointing here, so old links still work. The merge is audited
        and there is no unmerge.
      </Notice>

      <Notice tone="info" icon="help" title="Finding the duplicate">
        This list is alphabetical by family name, twenty-five at a time. The API offers no name
        or phone search yet, so page to the right letter rather than assuming a person is not
        here.
      </Notice>

      {!page.ok ? (
        <Notice tone="bad" announce title="The register could not be loaded">
          {page.message
            ?? 'The request did not reach the API. Nothing has been changed; try again in a moment.'}
        </Notice>
      ) : candidates.length === 0 ? (
        <div className="card">{NO_CANDIDATES}</div>
      ) : (
        <div className="card panel-table">
          {/*
            `<DataTable>` rather than the table this was written out as. The markup was
            already close — a real `<table>`, a `.table-scroll` wrapper, `scope` on every
            column header, and an `.sr-only` word inside the action header rather than an
            empty cell — and two things were still missing.

            The scroll wrapper was not focusable, so the columns that overflow on a narrow
            screen could not be reached by anyone not holding a mouse. And the name column
            was a `<td>`: this table has six columns and the fifth is a date, so a screen
            reader reading across a row announced five values with no idea whose they were.
            `rowHeader` makes the name the row's accessible name, which is the whole point of
            the component. It is also visible: `.table tbody th` in console.css carries the
            weight a row's name is supposed to have, so this column now reads as the name it
            is rather than as the first of six equal cells.
          */}
          <DataTable
            caption="Patients that could be folded into this record"
            captionHidden
            rows={candidates}
            rowKey={(candidate) => candidate.id}
            /* Unreachable: the branch above catches an empty page first and keeps the plain
               card this screen has always shown for it. `empty` is required by construction,
               so it names the same node rather than a second wording that could drift. */
            empty={NO_CANDIDATES}
            columns={[
              {
                key: 'name',
                header: 'Name',
                rowHeader: true,
                cell: (candidate) => `${candidate.family_name}, ${candidate.given_name}`,
              },
              {
                key: 'phone',
                header: 'Phone',
                numeric: true,
                cell: (candidate) => candidate.phone,
              },
              {
                key: 'dob',
                header: 'Date of birth',
                cell: (candidate) =>
                  candidate.date_of_birth === null ? (
                    <span className="muted">—</span>
                  ) : (
                    <DateTime value={candidate.date_of_birth} format="date" />
                  ),
              },
              {
                key: 'status',
                header: 'Status',
                cell: (candidate) => (
                  <Badge tone={statusDisplay(candidate.status).tone}>
                    {statusDisplay(candidate.status).label}
                  </Badge>
                ),
              },
              {
                key: 'registered',
                header: 'Registered',
                cell: (candidate) =>
                  candidate.created_at === null ? (
                    <span className="muted">—</span>
                  ) : (
                    <DateTime value={candidate.created_at} format="date" />
                  ),
              },
              {
                key: 'choose',
                header: 'Choose',
                headerHidden: true,
                /* A link, not a submit. Choosing is not the merge — it opens the
                   confirmation, which is the step that actually asks. */
                cell: (candidate) => (
                  <a
                    className="lnk"
                    href={`${returnHref}?duplicate=${encodeURIComponent(candidate.id)}`}
                  >
                    This is the duplicate
                  </a>
                ),
              },
            ]}
          />
        </div>
      )}

      {page.ok ? (
        <Pager
          page={page.value}
          href={(next) => `${returnHref}?cursor=${encodeURIComponent(next)}`}
        />
      ) : null}

      <div>
        <Button href={paths.record(survivor.id)} variant="quiet">
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * Step two: both records, side by side, with the survivor marked.
 *
 * THE COMPARISON IS THE CONTROL. Two people with the same surname and adjacent dates of birth
 * are a family, not a duplicate, and the only thing standing between the two is a receptionist
 * reading both records before pressing the button. So every field that distinguishes one person
 * from another is shown on both sides — name, phone, date of birth, national ID, address — and
 * the surviving column is labelled as such in words rather than by position alone.
 */
async function ConfirmStep({
  paths,
  survivor,
  duplicateId,
  returnHref,
  error,
}: {
  paths: PatientsPaths
  survivor: Patient
  duplicateId: string
  returnHref: string
  error: string | undefined
}): Promise<ReactElement> {
  const duplicate = await tryReadPatient(duplicateId)

  /*
   * 404 AND 403 ARRIVE AS THE SAME NULL, deliberately. A record belonging to another clinic
   * answers 404 rather than 403 precisely so nobody can learn it exists from the shape of a
   * refusal, and this screen must not recover that distinction. It is a notice rather than a
   * `notFound()` because the SURVIVOR is perfectly readable and the desk should land back on
   * the chooser rather than on a not-found page for a record they still have open.
   */
  if (duplicate === null) {
    return (
      <div className="grid">
        <Notice tone="bad" announce title="That record could not be opened">
          It may not exist, or it may not be this clinic’s. Nothing has been merged.
        </Notice>
        <div>
          <Button href={returnHref} variant="quiet">
            Choose a different record
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="grid">
      {error !== undefined ? (
        <Notice tone="bad" announce title="Nothing was merged">
          {error}
        </Notice>
      ) : null}

      <Notice tone="warn" icon="shield" announce title="Read both records before you confirm">
        Two people with the same surname are a family, not a duplicate. Check the phone number,
        the date of birth and the national ID on both sides. There is no way to undo this.
      </Notice>

      <div className="grid g-2">
        <RecordColumn
          patient={survivor}
          role="Survives"
          note="Everything moves onto this record. This is the one the clinic keeps using."
          tone="good"
        />
        <RecordColumn
          patient={duplicate}
          role="Folded in"
          note="Its history moves across. The row is kept, pointing at the surviving record, so old links still work."
          tone="warn"
        />
      </div>

      <Notice tone="info" icon="shield" title="The status will not change">
        The surviving record keeps the status it has now. If it is still awaiting consent, it
        stays awaiting consent even when the duplicate had consented — capture consent again
        with the patient rather than assuming the merge carried it across.
      </Notice>

      <form action={submitMerge.bind(null, {
        survivorId: survivor.id,
        duplicateId: duplicate.id,
        returnHref,
        recordHref: paths.record(survivor.id),
      })}
      >
        <div className="row-wrap">
          <Button type="submit" variant="danger">
            <Icon name="users" /> Merge {duplicate.given_name} {duplicate.family_name} into{' '}
            {survivor.given_name} {survivor.family_name}
          </Button>
          <Button href={returnHref} variant="quiet">
            Choose a different record
          </Button>
          <Button href={paths.record(survivor.id)} variant="quiet">
            Cancel
          </Button>
        </div>
      </form>
    </div>
  )
}

/** One side of the comparison. Labelled by what happens to it, not by which column it is in. */
function RecordColumn({
  patient,
  role,
  note,
  tone,
}: {
  patient: Patient
  role: string
  note: string
  tone: 'good' | 'warn'
}): ReactElement {
  return (
    <Card as="section" aria-label={`${role}: ${patient.given_name} ${patient.family_name}`}>
      {/* The heading row and the note were flush and the list was pushed down by a margin.
          Nesting says both: `gap="2"` is what `.card stack` gave the first pair, and the
          outer gap is the class gap and the margin added together, on the scale. */}
      <Stack gap="6">
        <Stack gap="2">
          <div className="row between">
            <h2 className="title-sm grow">
              {patient.given_name} {patient.family_name}
            </h2>
            <Badge tone={tone}>{role}</Badge>
          </div>

          <p className="muted">{note}</p>
        </Stack>

        {/*
          SURVIVING INLINE STYLE, and it is one gap on a `<dl>`. Neither Stack's element
          union nor Grid's includes a description list, deliberately: `<dl>` promises a
          screen reader that its children are term-and-definition pairs, and the only legal
          children are `<dt>`, `<dd>` and the `<div>`s grouping them — so a primitive can go
          neither on it nor inside it. `.pairs` in console.css is the single-column grid at 12px
          that five call sites were each restating inline, named for what it lays out.
        */}
        <dl className="pairs">
          <Row label="Phone">
            <span className="tnum">{patient.phone}</span>
          </Row>
          <Row label="Date of birth">
            {patient.date_of_birth === null ? (
              <span className="muted">Not recorded</span>
            ) : (
              <DateTime value={patient.date_of_birth} format="date" />
            )}
          </Row>
          <Row label="National ID">
            {patient.national_id_number ?? <span className="muted">Not recorded</span>}
          </Row>
          <Row label="Address">{patient.address ?? <span className="muted">Not recorded</span>}</Row>
          <Row label="Status">
            <Badge tone={statusDisplay(patient.status).tone}>
              {statusDisplay(patient.status).label}
            </Badge>
          </Row>
          <Row label="Registered">
            {patient.created_at === null ? (
              <span className="muted">—</span>
            ) : (
              <DateTime value={patient.created_at} format="date" />
            )}
          </Row>
        </dl>
      </Stack>
    </Card>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }): ReactElement {
  return (
    <div className="stack">
      <dt className="field__label">{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

/**
 * What the candidate list says when a page of the register holds nobody else.
 *
 * ONE NODE, TWO PLACES. The screen renders it in a plain card when the page comes back
 * empty, and `<DataTable>` requires an `empty` of its own — see that component for why a
 * table that can render an empty body is a table that renders nothing at all. Naming it
 * once is what stops the two wordings drifting into saying different things about the same
 * state.
 */
const NO_CANDIDATES = (
  <EmptyState icon="users" title="No other patients on this page">
    Page through the register to find the duplicate registration.
  </EmptyState>
)

/** Previous and next, as links. Cursor pagination, never offset — see `listPatients`. */
function Pager({
  page,
  href,
}: {
  page: { readonly nextCursor: string | null; readonly prevCursor: string | null }
  href: (cursor: string) => string
}): ReactElement | null {
  if (page.prevCursor === null && page.nextCursor === null) {
    return null
  }

  return (
    <nav className="row-wrap" aria-label="Register pages">
      {page.prevCursor === null ? null : (
        <Button variant="quiet" href={href(page.prevCursor)}>
          Previous
        </Button>
      )}
      {page.nextCursor === null ? null : (
        <Button variant="quiet" href={href(page.nextCursor)}>
          Next
        </Button>
      )}
    </nav>
  )
}
