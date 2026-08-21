import { Button, Card, DateTime, EmptyState, Notice } from '@carevelo/ui'
import type { Attempt } from '../api/http'
import { actionLabel, type AuditEvent, type AuditFilters, type AuditPage } from '../api/types'

/**
 * The evidence layer, read.
 *
 * ------------------------------------------------------------------
 * THERE IS NO CONTROL ON THIS SCREEN THAT CHANGES ANYTHING
 *
 * No edit, no delete, no "archive", no retention setting, no export button. That is not
 * caution, it is the shape of the thing: no API can write, update or delete an audit event,
 * and the application's database role is denied UPDATE and DELETE by grant, so the guarantee
 * holds even against code running with the application's own credentials. A control here
 * would be a control that could not work — and worse, one that suggested the log is
 * something a clinic or Carevelo can curate.
 *
 * The screen says so out loud, because a clinic administrator who believes the log is
 * editable will eventually ask someone to edit it, and the person they ask needs the same
 * sentence.
 *
 * ------------------------------------------------------------------
 * READING THIS IS ITSELF AUDITED, AND THE SCREEN SAYS THAT TOO
 *
 * Every load writes an `audit_log.read` event naming the reader and the filters they used.
 * Otherwise the trail would have a blind spot exactly where an insider would look: somebody
 * checking whether their own access had been noticed would leave no trace of having checked.
 * Telling the reader is not a warning, it is the same courtesy the log extends to everyone
 * else in it.
 *
 * It is also why nothing here refreshes on a timer. A polling audit screen would fill the
 * clinic's own trail with its own reads, and the signal an investigator needs would be
 * buried under the noise of the tool they were investigating with.
 *
 * ------------------------------------------------------------------
 * WHAT IS NOT IN A ROW
 *
 * An event records THAT something happened to WHICH record. What the record said is only
 * available from the record itself, under its own authorisation. `metadata` is scrubbed
 * twice by the API — once on write, once on read — against the same prohibited-content list
 * the SMS templates are checked against, and a key named for a clinical or personal field is
 * dropped whatever it holds. This screen renders what survives and never tries to fill the
 * gaps in.
 */

export type AuditLogScreenProps = {
  page: Attempt<AuditPage>
  filters: AuditFilters
  /** This screen's own path, for the filter form and the cursor links. */
  selfPath: string
}

export function AuditLogScreen({ page, filters, selfPath }: AuditLogScreenProps) {
  return (
    <div className="grid">
      <div className="page-head">
        <div className="grow">
          <h1>Audit log</h1>
          <p>Who did what, when, and to which record.</p>
        </div>
      </div>

      <Notice tone="info" title="Nothing here can be changed or removed">
        <p>
          The audit log is append-only for everyone, including Carevelo. No part of the
          platform can edit or delete a line — the database itself refuses it — so there is no
          control on this screen that would do so, and nobody can be asked for one.
        </p>
        <p>
          Opening this page is recorded in the log as well, under your name, along with the
          filters you used. That is deliberate: a trail with a blind spot where someone
          checks whether they were noticed is not a trail.
        </p>
      </Notice>

      <Card as="section">
        <h2 className="title">Narrow it down</h2>
        <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
          You cannot search inside the details of an event. That is on purpose — a searchable
          details field would turn this log into an index over whatever was once put in it.
        </p>

        <Filters filters={filters} selfPath={selfPath} />
      </Card>

      {page.ok ? (
        <Results page={page.value} filters={filters} selfPath={selfPath} />
      ) : (
        <Refusal status={page.status} message={page.message} />
      )}
    </div>
  )
}

function Filters({ filters, selfPath }: { filters: AuditFilters; selfPath: string }) {
  return (
    /* A native GET form with no cursor field, so changing a filter starts from the first
       page. Carrying a cursor across a filter change would page into a result set the cursor
       was never cut from. */
    <form method="get" action={selfPath} className="row-wrap" style={{ marginTop: 'var(--space-5)' }}>
      <div className="field">
        <label className="field__label" htmlFor="audit-action">
          Action
        </label>
        <input
          className="input mono"
          id="audit-action"
          name="action"
          defaultValue={filters.action ?? ''}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
        />
        <span className="field__hint">
          Exactly as it appears in the table, e.g. payment_intent.cash_attested
        </span>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="audit-actor">
          Who
        </label>
        <input
          className="input mono"
          id="audit-actor"
          name="actor_id"
          defaultValue={filters.actorId ?? ''}
          autoComplete="off"
          spellCheck={false}
        />
        <span className="field__hint">A staff account identifier.</span>
      </div>

      <div className="field">
        <label className="field__label" htmlFor="audit-subject-type">
          Kind of record
        </label>
        <input
          className="input mono"
          id="audit-subject-type"
          name="subject_type"
          defaultValue={filters.subjectType ?? ''}
          maxLength={64}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="audit-subject-id">
          Which record
        </label>
        <input
          className="input mono"
          id="audit-subject-id"
          name="subject_id"
          defaultValue={filters.subjectId ?? ''}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="audit-from">
          From
        </label>
        <input className="input" type="date" id="audit-from" name="from" defaultValue={filters.from ?? ''} />
      </div>

      <div className="field">
        <label className="field__label" htmlFor="audit-to">
          To
        </label>
        <input className="input" type="date" id="audit-to" name="to" defaultValue={filters.to ?? ''} />
      </div>

      <Button type="submit" variant="quiet">
        Filter
      </Button>
    </form>
  )
}

function Results({
  page,
  filters,
  selfPath,
}: {
  page: AuditPage
  filters: AuditFilters
  selfPath: string
}) {
  if (page.events.length === 0) {
    return (
      <Card as="section">
        <EmptyState title="No events match">
          Nothing in this clinic&rsquo;s trail matches those filters. Clear them to see
          everything, newest first.
        </EmptyState>
      </Card>
    )
  }

  return (
    <Card as="section">
      <div className="table-scroll">
        <table className="table">
          <caption className="fine" style={{ captionSide: 'bottom', textAlign: 'left' }}>
            Newest first. An event says that something happened to a record — what the record
            said is only on the record itself.
          </caption>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">What happened</th>
              <th scope="col">Who</th>
              <th scope="col">Which record</th>
              <th scope="col">Details</th>
            </tr>
          </thead>
          <tbody>
            {page.events.map((event) => (
              <Row key={event.id} event={event} />
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} filters={filters} selfPath={selfPath} />
    </Card>
  )
}

function Row({ event }: { event: AuditEvent }) {
  const label = actionLabel(event.action)

  return (
    <tr>
      <td>
        <DateTime value={event.occurredAt} format="datetime" />
      </td>
      <td>
        {/* The raw key is always shown, whether or not this build has a sentence for it: it
            is the only thing an investigator can filter on. */}
        <div className="mono">{event.action}</div>
        {label === null ? null : <div className="fine">{label}</div>}
      </td>
      <td>
        {event.actorRole === null && event.actorId === null ? (
          <span className="muted">The system</span>
        ) : (
          <>
            {event.actorRole === null ? null : <div>{event.actorRole}</div>}
            {event.actorId === null ? null : <div className="fine mono">{event.actorId}</div>}
          </>
        )}
        {event.ipAddress === null ? null : <div className="fine mono">{event.ipAddress}</div>}
      </td>
      <td>
        {event.subjectType === null ? (
          <span className="muted">—</span>
        ) : (
          <>
            <div>{event.subjectType}</div>
            {event.subjectId === null ? null : <div className="fine mono">{event.subjectId}</div>}
          </>
        )}
      </td>
      <td>
        <Metadata metadata={event.metadata} requestId={event.requestId} />
      </td>
    </tr>
  )
}

/**
 * The surviving details of an event.
 *
 * SCALARS ARE PRINTED AND EVERYTHING ELSE IS SUMMARISED. A nested structure is rendered as
 * the fact that it is one rather than as JSON: the API has already scrubbed this object of
 * anything clinical or personal, and expanding an arbitrary tree into a table cell would
 * either be unreadable or, at width, would reintroduce the wall of payload the scrub exists
 * to prevent. An investigator who needs the whole structure has the request id and the
 * application logs.
 */
function Metadata({
  metadata,
  requestId,
}: {
  metadata: Readonly<Record<string, unknown>>
  requestId: string | null
}) {
  const entries = Object.entries(metadata)

  if (entries.length === 0 && requestId === null) {
    return <span className="muted">—</span>
  }

  return (
    <dl className="stack">
      {entries.map(([key, value]) => (
        <div key={key}>
          <dt className="fine">{key}</dt>
          <dd className="mono">{describe(value)}</dd>
        </div>
      ))}
      {requestId === null ? null : (
        <div>
          <dt className="fine">request id</dt>
          <dd className="mono">{requestId}</dd>
        </div>
      )}
    </dl>
  )
}

function describe(value: unknown): string {
  if (value === null) {
    return 'null'
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (Array.isArray(value)) {
    return `${value.length} item${value.length === 1 ? '' : 's'}`
  }

  if (typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>)

    return keys.length === 0 ? 'empty' : keys.join(', ')
  }

  return 'not recorded'
}

/**
 * Cursor pagination, as two links.
 *
 * The trail grows while somebody pages through it — including from this very read, since
 * every load writes its own `audit_log.read` event — so an offset would duplicate and skip
 * rows in a record whose entire value is that it is complete.
 */
function Pagination({
  page,
  filters,
  selfPath,
}: {
  page: AuditPage
  filters: AuditFilters
  selfPath: string
}) {
  if (page.nextCursor === null && page.prevCursor === null) {
    return null
  }

  return (
    <nav className="row-wrap" style={{ marginTop: 'var(--space-5)' }} aria-label="More events">
      {page.prevCursor === null ? null : (
        <a className="lnk" href={hrefFor(selfPath, filters, page.prevCursor)}>
          Newer
        </a>
      )}
      {page.nextCursor === null ? null : (
        <a className="lnk" href={hrefFor(selfPath, filters, page.nextCursor)}>
          Older
        </a>
      )}
    </nav>
  )
}

function hrefFor(selfPath: string, filters: AuditFilters, cursor: string): string {
  const query = new URLSearchParams()
  const carried: [string, string | undefined][] = [
    ['action', filters.action],
    ['actor_id', filters.actorId],
    ['subject_type', filters.subjectType],
    ['subject_id', filters.subjectId],
    ['from', filters.from],
    ['to', filters.to],
  ]

  for (const [key, value] of carried) {
    if (value !== undefined) {
      query.set(key, value)
    }
  }

  query.set('cursor', cursor)

  return `${selfPath}?${query.toString()}`
}

/**
 * The API declined, and the screen says which kind of declining it was.
 *
 * 403 IS THE BOUNDARY WORKING. The trail names which patients each colleague looked at, so a
 * clinician does not audit the clinic. Rendered as information rather than as a fault, so
 * that the people it is not for stop rather than raise a ticket.
 *
 * A 422 is worth passing through verbatim: the API validates that an identifier filter is a
 * ULID and that `to` is not before `from`, and its sentence says which of those was wrong.
 */
function Refusal({ status, message }: { status: number | null; message: string | null }) {
  if (status === 403) {
    return (
      <Notice tone="info" title="The audit log is the clinic administrator’s view">
        <p>
          It records which colleague looked at which patient, so it is limited to the
          administrator account rather than shared across the clinic.
        </p>
      </Notice>
    )
  }

  return (
    <Notice tone="bad" title="The audit log could not be loaded" announce>
      <p>{message ?? 'The request did not reach the API. Try again in a moment.'}</p>
    </Notice>
  )
}
