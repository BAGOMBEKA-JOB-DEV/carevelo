import {
  Button,
  DataTable,
  DateTime,
  EmptyState,
  Field,
  Inline,
  Input,
  Notice,
  PageHeader,
  Stack,
  Toolbar,
} from '@carevelo/ui'
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
      <PageHeader
        title="Audit log"
        description={
          <>
            Who did what, when, and to which record.
          </>
        }
      />

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

      {/* THE FILTERS COME OUT OF THEIR CARD. `.console-bar` in console.css is the one shape
          above every list in this console — the registry's and the reconciliation screen's
          already wear it, and this was the third invention of the same idea, a `.card` with
          24px of padding competing for weight with the table it filters. The heading and its
          paragraph stay: the paragraph is the only place the product says why there is no
          full-text search, which is the first thing an investigator goes looking for. */}
      <Stack gap="4">
        <Stack gap="2">
          <h2 className="title">Narrow it down</h2>
          <p className="muted">
            You cannot search inside the details of an event. That is on purpose — a searchable
            details field would turn this log into an index over whatever was once put in it.
          </p>
        </Stack>

        <Filters filters={filters} selfPath={selfPath} />
      </Stack>

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
       was never cut from.

       Six hand-assembled `.field`/`.input`/`.field__hint` blocks became six `<Field>`s. Field
       owns the `htmlFor`/`id` pair AND the `aria-describedby` that ties a hint to its control
       — the hand-written version had the labels wired and the two hints wired to nothing, so
       "Exactly as it appears in the table" was on screen and absent from the announcement for
       the one person most likely to need telling what shape the value takes. */
    <Toolbar
      as="form"
      method="get"
      action={selfPath}
      label="Narrow down the audit log"
      className="console-bar"
      actions={
        <Button type="submit" variant="quiet">
          Filter
        </Button>
      }
    >
      <Field
        name="action"
        id="audit-action"
        label="Action"
        hint="Exactly as it appears in the table, e.g. payment_intent.cash_attested"
      >
        {(control) => (
          <Input
            {...control}
            className="mono"
            defaultValue={filters.action ?? ''}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </Field>

      <Field name="actor_id" id="audit-actor" label="Who" hint="A staff account identifier.">
        {(control) => (
          <Input
            {...control}
            className="mono"
            defaultValue={filters.actorId ?? ''}
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </Field>

      <Field name="subject_type" id="audit-subject-type" label="Kind of record">
        {(control) => (
          <Input
            {...control}
            className="mono"
            defaultValue={filters.subjectType ?? ''}
            maxLength={64}
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </Field>

      <Field name="subject_id" id="audit-subject-id" label="Which record">
        {(control) => (
          <Input
            {...control}
            className="mono"
            defaultValue={filters.subjectId ?? ''}
            autoComplete="off"
            spellCheck={false}
          />
        )}
      </Field>

      <Field name="from" id="audit-from" label="From">
        {(control) => <Input {...control} type="date" defaultValue={filters.from ?? ''} />}
      </Field>

      <Field name="to" id="audit-to" label="To">
        {(control) => <Input {...control} type="date" defaultValue={filters.to ?? ''} />}
      </Field>
    </Toolbar>
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
  return (
    <Stack gap="5">
      {/*
       * `.card .panel-table` is the wrapper and `.queue` is on the scroll region inside it —
       * console.css rules 6 and 8. The card supplies the border and the corner, `.panel-table`
       * removes the 24px of padding that framed a table which already has its own cell
       * padding, and `.queue` bounds the height so the column headings have something to
       * stick to. An investigator reads forty rows of this looking for one; with the headings
       * gone, "Who" and "Which record" are two columns of identifiers that cannot be told
       * apart, which is the exact moment a trail stops being readable.
       *
       * THE EMPTY STATE IS THE TABLE'S OWN SLOT NOW rather than a separate card that replaced
       * the table. The headings and the caption stay put, so the page does not change shape
       * when a filter empties it — and the caption's sentence about what an event does and
       * does not contain still reaches the person who filtered everything away.
       *
       * The caption also moves from the foot of the table to its head, which is where the
       * element belongs: DataTable makes it the accessible NAME of the scroll region, so a
       * screen-reader user hears what these rows are before the columns rather than after
       * forty of them. `captionSide: 'bottom'` and `textAlign: 'left'` both go — the second
       * is `.layout .table caption` in console.css already.
       */}
      <div className="card panel-table">
        <DataTable
          className="queue"
          caption="Newest first. An event says that something happened to a record — what the record said is only on the record itself."
          rows={page.events}
          rowKey={(event) => event.id}
          empty={
            <EmptyState title="No events match" icon="shield">
              Nothing in this clinic&rsquo;s trail matches those filters. Clear them to see
              everything, newest first.
            </EmptyState>
          }
          columns={[
            {
              key: 'when',
              header: 'When',
              cell: (event) => <DateTime value={event.occurredAt} format="datetime" />,
            },
            {
              /* The action NAMES the row: it is the thing that happened, and every other
                 column is a qualifier on it. A screen reader saying "payment_intent.cash_
                 attested, Who, Sarah Nakato" is the sentence an investigator is reading;
                 the same name read against a timestamp is not. */
              key: 'action',
              header: 'What happened',
              rowHeader: true,
              cell: (event) => <ActionCell event={event} />,
            },
            {
              key: 'actor',
              header: 'Who',
              cell: (event) => <ActorCell event={event} />,
            },
            {
              key: 'subject',
              header: 'Which record',
              cell: (event) =>
                event.subjectType === null ? (
                  <span className="muted">—</span>
                ) : (
                  <>
                    <div>{event.subjectType}</div>
                    {event.subjectId === null ? null : (
                      <div className="fine mono">{event.subjectId}</div>
                    )}
                  </>
                ),
            },
            {
              key: 'details',
              header: 'Details',
              cell: (event) => <Metadata metadata={event.metadata} requestId={event.requestId} />,
            },
          ]}
        />
      </div>

      <Pagination page={page} filters={filters} selfPath={selfPath} />
    </Stack>
  )
}

function ActionCell({ event }: { event: AuditEvent }) {
  const label = actionLabel(event.action)

  return (
    <>
      {/* The raw key is always shown, whether or not this build has a sentence for it: it
          is the only thing an investigator can filter on. */}
      <div className="mono">{event.action}</div>
      {label === null ? null : <div className="fine">{label}</div>}
    </>
  )
}

function ActorCell({ event }: { event: AuditEvent }) {
  return (
    <>
      {event.actorRole === null && event.actorId === null ? (
        <span className="muted">The system</span>
      ) : (
        <>
          {event.actorRole === null ? null : <div>{event.actorRole}</div>}
          {event.actorId === null ? null : <div className="fine mono">{event.actorId}</div>}
        </>
      )}
      {event.ipAddress === null ? null : <div className="fine mono">{event.ipAddress}</div>}
    </>
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
 *
 * NOT `<Pagination>` FROM THE SHARED LAYER, for the same reason the message log kept its own:
 * that component is cursor-only and fits the mechanism exactly, but its controls are labelled
 * "Previous" and "Next" and cannot be relabelled. On a trail ordered newest-first those words
 * are ambiguous in the worst available way — "previous" is either the page you came from or
 * the events that came before these — and an investigator reading a log has to be certain
 * which direction they moved. "Newer" and "Older" say it without the reader working out the
 * sort order first. If Pagination ever takes its labels as props, this becomes a call site.
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
    <nav aria-label="More events">
      <Inline gap="4">
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
      </Inline>
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
