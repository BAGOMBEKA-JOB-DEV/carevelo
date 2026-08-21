import type { ReactElement } from 'react'
import { Badge, Button, DateTime, EmptyState, Field, Icon, Input, Notice, Select } from '@carevelo/ui'
import { attempt } from '../api/http'
import { listPatients } from '../api/patients'
import type { Patient, PatientStatus } from '../api/types'
import { statusDisplay } from '../model/status'
import type { PatientsPaths } from '../model/paths'

/**
 * The registry: everyone this clinic may treat, and nobody else.
 *
 * ------------------------------------------------------------
 * THE SEARCH BOX IS THE HONEST PART OF THIS SCREEN, SO READ THIS BEFORE CHANGING IT.
 *
 * `GET /v1/patients` takes ONE filter. `PatientController::index` allow-lists its query —
 * "Never build a query from arbitrary client input" — and `status` is the entire allow-list.
 * There is no `q`, no name parameter, no phone lookup. The list comes back ordered by family
 * name, then given name, then id, twenty-five at a time, by cursor.
 *
 * So a search box on this screen can do exactly one truthful thing: narrow the page that is
 * already loaded. It is labelled as doing that, and the notice beside it says plainly that
 * there is no clinic-wide search yet. The alternative — a box that looks like it searches the
 * register and silently examines twenty-five of four hundred rows — is the worst outcome
 * available: a receptionist concludes a patient is not registered, registers them again, and
 * the clinic now has a duplicate to merge and half a medical history on each side of it.
 *
 * WHAT THE DESK ACTUALLY DOES TODAY TO FIND SOMEBODY BY NUMBER, and it works: register them.
 * `PatientController::store` looks the phone up first and returns the EXISTING record with the
 * same 201 and the same body rather than creating a second one. That is not a workaround, it
 * is the endpoint's designed behaviour — saying "this number is already registered" would
 * confirm that a named person is a patient of this clinic, which is special-category
 * disclosure under the DPPA 2019. The registration screen says so, and the notice below points
 * at it.
 *
 * THE REAL FIX IS A SERVER-SIDE FILTER on the index endpoint, and it is recorded rather than
 * faked here. See the handover note accompanying this domain.
 *
 * ------------------------------------------------------------
 * CURSOR PAGINATION, NEVER OFFSET. Front desk pages through this while walk-in registrations
 * are being created beside them, and an offset under exactly that traffic duplicates and skips
 * rows. Previous and next are ordinary links carrying a cursor, so paging works with no
 * JavaScript at all — which on a shared terminal on a bad line is not a hypothetical.
 *
 * MERGED DUPLICATES ARE NOT IN THIS LIST. The API applies `notMerged()`, because a merged
 * duplicate holds no history any more and listing it invites staff to open the empty half of a
 * person. One is still reachable by an old link, and the record screen signposts it.
 */

export type RegistryScreenProps = {
  paths: PatientsPaths
  /** `?status=` — the one filter the API actually applies. */
  status?: string | undefined
  /** `?find=` — narrows the loaded page only, and says so. */
  find?: string | undefined
  cursor?: string | undefined
  /** `?done=` — what the desk just finished, echoed back so the page can confirm it. */
  done?: string | undefined
}

/** The statuses the API's own enum defines, in the order a desk thinks about them. */
const STATUS_OPTIONS: readonly PatientStatus[] = [
  'pending_consent',
  'active',
  'withdrawn',
  'discarded',
]

export async function RegistryScreen({
  paths,
  status,
  find,
  cursor,
  done,
}: RegistryScreenProps): Promise<ReactElement> {
  /*
   * Narrowed against the contract's own union rather than passed through. An unknown value
   * from a stale link would be a 422 from the API's `Rule::enum`, which on this screen would
   * replace the whole registry with an error for a query parameter nobody typed.
   */
  const activeStatus = STATUS_OPTIONS.find((option) => option === status)

  const page = await attempt(
    listPatients({
      status: activeStatus,
      cursor: cursor === '' ? undefined : cursor,
    }),
  )

  const term = (find ?? '').trim()
  const rows = page.ok ? page.value.patients.filter((patient) => matches(patient, term)) : []

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Patients</h1>
          <p>
            Everyone this clinic may treat. There is no cross-clinic patient search and there
            will not be one — the boundary between clinics is absolute.
          </p>
        </div>
        <Button href={paths.register}>
          <Icon name="user" /> Register a patient
        </Button>
      </div>

      <div className="grid">
        {done === 'merged' ? (
          <Notice tone="info" icon="check" announce title="Duplicate merged">
            The duplicate registration now points at this record and its history moved across.
            The surviving record’s status was not changed by the merge — check below that it is
            what you expect.
          </Notice>
        ) : null}

        {/* ---- Filter and find ------------------------------------------------
            A plain GET form. Submitting it puts the values in the URL, which is what makes
            the filtered view a link a receptionist can keep open in a second tab. It also
            drops the cursor, which is correct: a new filter starts at the first page. */}
        <form method="get" action={paths.registry} className="card">
          <div className="grid g-2">
            <Field
              name="status"
              label="Status"
              hint="Applied by the API across the whole register."
            >
              {(control) => (
                <Select {...control} defaultValue={activeStatus ?? ''}>
                  <option value="">Every status</option>
                  {STATUS_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {statusDisplay(option).label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              name="find"
              label="Find on this page"
              hint="Name or phone number. Narrows the 25 rows below — not the whole register."
            >
              {(control) => (
                <Input {...control} type="search" autoComplete="off" defaultValue={term} />
              )}
            </Field>
          </div>

          <div className="row-wrap" style={{ marginTop: 'var(--space-5)' }}>
            <Button type="submit">Apply</Button>
            {activeStatus !== undefined || term !== '' ? (
              <Button href={paths.registry} variant="quiet">
                Clear
              </Button>
            ) : null}
          </div>
        </form>

        <Notice tone="info" icon="help" title="Looking for one person?">
          This console cannot yet search the whole register by name or number — the API offers
          a status filter and nothing else. To find somebody by their phone number, start a
          registration with it: if that number is already on file you are taken straight to
          their record and nothing new is created.
        </Notice>

        {!page.ok ? (
          <Notice tone="bad" announce title="The register could not be loaded">
            {page.message
              ?? 'The request did not reach the API. Check the connection and try again; nothing has been changed.'}
          </Notice>
        ) : rows.length === 0 ? (
          <div className="card">
            <EmptyState
              icon="users"
              title={emptyTitle(page.value.patients.length, term, activeStatus)}
              action={
                <Button href={paths.register}>
                  <Icon name="user" /> Register a patient
                </Button>
              }
            >
              {emptyBody(page.value.patients.length, term)}
            </EmptyState>
          </div>
        ) : (
          <div className="card" style={{ padding: 0 }}>
            <div className="table-scroll">
              <table className="table">
                <caption className="sr-only">
                  Patients registered at this clinic, by family name
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Phone</th>
                    <th scope="col">Status</th>
                    <th scope="col">Portal account</th>
                    <th scope="col">Registered</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((patient) => (
                    <PatientRow key={patient.id} patient={patient} paths={paths} />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {page.ok ? <Pager page={page.value} paths={paths} status={activeStatus} /> : null}
      </div>
    </>
  )
}

/**
 * One row. The name is the link, because it is the thing a receptionist is looking at when
 * they decide to open a record.
 */
function PatientRow({
  patient,
  paths,
}: {
  patient: Patient
  paths: PatientsPaths
}): ReactElement {
  const display = statusDisplay(patient.status)

  return (
    <tr>
      <td>
        <a href={paths.record(patient.id)}>
          {patient.family_name}, {patient.given_name}
        </a>
      </td>
      {/* tnum so a column of numbers lines up and a transposed digit is visible. */}
      <td className="tnum">{patient.phone}</td>
      <td>
        <Badge tone={display.tone}>{display.label}</Badge>
      </td>
      <td>
        {/*
          `has_account` is derived and carries no address and no user identifier — front desk
          needs to know whether to offer to create one, and nothing more. "No" is the ordinary
          answer and is written as plain text rather than as a warning badge: not having a
          portal account is not a problem with a patient record.
        */}
        {patient.has_account ? <Badge tone="info">Yes</Badge> : <span className="muted">No</span>}
      </td>
      <td>
        {patient.created_at === null ? (
          <span className="muted">—</span>
        ) : (
          <DateTime value={patient.created_at} format="date" />
        )}
      </td>
    </tr>
  )
}

/**
 * Previous and next, as links.
 *
 * The `find` term is deliberately NOT carried across a page change. It filters the rows that
 * happen to be loaded, so carrying it to the next page would produce a screen that says "no
 * matches" about twenty-five rows the receptionist never saw — which reads as "not registered
 * here" and is exactly the wrong conclusion. Changing page clears it; the status filter, which
 * the API really applies, is carried.
 */
function Pager({
  page,
  paths,
  status,
}: {
  page: { readonly nextCursor: string | null; readonly prevCursor: string | null }
  paths: PatientsPaths
  status: PatientStatus | undefined
}): ReactElement | null {
  if (page.prevCursor === null && page.nextCursor === null) {
    return null
  }

  const href = (cursor: string): string => {
    const query = new URLSearchParams({ cursor })

    if (status !== undefined) {
      query.set('status', status)
    }

    return `${paths.registry}?${query.toString()}`
  }

  return (
    <nav className="row-wrap" aria-label="Registry pages">
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

/**
 * Does this row match what was typed into the find box?
 *
 * Names are compared case-insensitively; the phone is compared on DIGITS ONLY, because the
 * register stores E.164 (`+256772123456`) and a receptionist types what the patient says
 * ("0772 123 456"). Stripping the leading zero as well would be guessing at a dialling
 * convention this file has no business owning — matching on the digit run means `772123456`
 * finds the row from either spelling, which is the useful half without the guess.
 *
 * Pure and total: an empty term matches everything, which is what makes the box optional.
 */
function matches(patient: Patient, term: string): boolean {
  if (term === '') {
    return true
  }

  const needle = term.toLowerCase()
  const name = `${patient.given_name} ${patient.family_name}`.toLowerCase()

  if (name.includes(needle)) {
    return true
  }

  const digits = term.replace(/\D+/g, '')

  return digits !== '' && patient.phone.replace(/\D+/g, '').includes(digits)
}

/** "Nothing on this page" and "nothing in this clinic" are different facts. Say which. */
function emptyTitle(loaded: number, term: string, status: PatientStatus | undefined): string {
  if (loaded > 0 && term !== '') {
    return 'Nobody on this page matches that'
  }

  return status === undefined ? 'No patients registered yet' : 'No patients with that status'
}

function emptyBody(loaded: number, term: string): string {
  if (loaded > 0 && term !== '') {
    return (
      'The find box only narrows the rows already loaded. Try the next page, or start a '
      + 'registration with the patient’s phone number — if they are already on file you will be '
      + 'taken to their record.'
    )
  }

  return 'Register the first patient at the desk, with the person in front of you.'
}
