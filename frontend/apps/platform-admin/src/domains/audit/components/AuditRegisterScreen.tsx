import {
  Badge,
  Button,
  Card,
  DataTable,
  DateTime,
  EmptyState,
  Field,
  Inline,
  Input,
  Notice,
  PageHeader,
  Pagination,
  Select,
  Stack,
  Toolbar,
} from '@carevelo/ui'
import { attempt } from '@/domains/identity'
import type { Tenant } from '@/domains/platform'
import { listAuditEvents } from '../api/events'
import { href } from '../model/links'
import { metadataPairs } from '../model/metadata'
import type { AuditEvent, AuditPaths, AuditQuery } from '../model/types'

/**
 * ============================================================
 * THE AUDIT REGISTER: the evidence layer, read back
 * ============================================================
 *
 * This screen was a "planned section" for as long as there was nothing honest to build it
 * against, and the file it replaced said so at length: `GET /v1/audit-events` is
 * tenant-scoped and clinic-admin-only, a platform operator has no tenant for it to scope
 * to, and the RBAC matrix describes something different again — platform events in full,
 * METADATA ONLY for a clinic's. `GET /v1/platform/audit-events` is that endpoint, and this
 * is that screen.
 *
 * ============================================================
 * ONE RESPONSE IS ONE TRAIL, AND THE SCREEN SAYS WHICH
 * ============================================================
 *
 * With no clinic chosen this is CAREVELO's own trail: break-glass grants, tenant
 * provisioning and suspension, TOTP enrolments, platform sign-ins. Those carry no tenant
 * and sit outside tenant row-level security, so until this endpoint existed nobody could
 * read them — anywhere, at all. The periodic break-glass review that is supposed to notice
 * a rising count had nothing to read, which is the difference between a control and a
 * belief.
 *
 * Choosing a clinic reads THAT CLINIC's trail instead. Never both at once: audit_events is
 * isolated in both directions, and a page spanning clinics would need a database policy
 * letting an unbound reader see tenant rows. So the heading above the table names the trail
 * rather than leaving an operator to infer it from a select box.
 *
 * ============================================================
 * WHAT A CLINIC'S ROW DOES NOT CONTAIN, AND WHY THE SCREEN SAYS SO OUT LOUD
 * ============================================================
 *
 * No payload, no record identifier, no staff member's address or device. The API withholds
 * them — `projection: 'metadata_only'` on every tenant-owned row — and this screen renders
 * that as a word rather than as an empty cell, because "withheld" and "there was nothing
 * there" are the same blank to a reader and only one of them means something.
 *
 * An operator who needs the record itself asks for a break-glass grant, which is
 * reason-recorded, time-boxed, notified to the clinic and audited. The register stops
 * exactly where break-glass starts, and the notice on this screen points at the door rather
 * than leaving somebody to conclude the product is broken.
 *
 * ============================================================
 * READING THIS SCREEN WRITES TO IT
 * ============================================================
 *
 * Every load appends an `audit_log.read` event to the platform trail naming the operator,
 * the filters and the clinic whose trail was read. That is deliberate — the log would
 * otherwise have a blind spot exactly where an insider would look — and it has two
 * consequences the screen has to respect: the list grows underneath whoever is paging
 * through it, which is why paging is by cursor and never by offset; and nothing here may be
 * fetched speculatively, because a prefetched page is a false entry in a security review.
 *
 * NO `'use client'` ANYWHERE IN THIS DOMAIN. Every filter is a plain GET form, so the
 * filter state lives in the URL — shareable during an incident, survives a refresh, and the
 * back button works. This app ships one client component in total and it is a theme toggle.
 */
export type AuditRegisterScreenProps = {
  paths: AuditPaths
  /**
   * The clinics, for the trail picker. `null` when the register read FAILED — the picker
   * degrades to an identifier field rather than disappearing, exactly as the break-glass
   * form does: this screen is opened during an incident, and an incident is when a
   * dependency is unwell.
   */
  clinics: readonly Tenant[] | null
  /** False when the register holds more clinics than one page of the picker. */
  clinicsComplete: boolean
  /** `?tenant_id=` — which trail. Absent means Carevelo's own. */
  tenantId?: string | undefined
  /** `?action=` — an exact action name, `break_glass.granted` and the like. */
  action?: string | undefined
  /** `?actor_id=` — one account, across everything it did. */
  actorId?: string | undefined
  /** `?from=` and `?to=` — inclusive days, resolved in Africa/Kampala by the API. */
  from?: string | undefined
  to?: string | undefined
  /** `?cursor=` — opaque, straight from `meta.next_cursor`. Never constructed here. */
  cursor?: string | undefined
}

export async function AuditRegisterScreen({
  paths,
  clinics,
  clinicsComplete,
  tenantId: tenantParam,
  action: actionParam,
  actorId: actorParam,
  from: fromParam,
  to: toParam,
  cursor: cursorParam,
}: AuditRegisterScreenProps) {
  /*
    NORMALISED ONCE, HERE, BECAUSE A SUBMITTED FORM SENDS EMPTY STRINGS RATHER THAN NOTHING.
    Every filter on this screen is a GET form, so choosing "Carevelo (platform events)" and
    pressing Read produces `?tenant_id=&action=&actor_id=&from=&to=` — five parameters that
    are present and empty, not absent. Left alone, `tenantId === undefined` is false for the
    platform trail, and the screen would announce a clinic trail it is not showing and print
    an empty clinic name in its own caption.

    The tenant register screen makes the same normalisation for the same reason and says so
    in its own comment. Doing it in one place at the top means every use below — the request,
    the heading, the badge, the empty state and the pager — agrees about what "no filter"
    means.
  */
  const tenantId = present(tenantParam)
  const action = present(actionParam)
  const actorId = present(actorParam)
  const from = present(fromParam)
  const to = present(toParam)
  const cursor = present(cursorParam)

  /*
    Built by spreading rather than by assigning `undefined`, because `exactOptionalPropertyTypes`
    makes "absent" and "present and undefined" different types — and because an empty filter
    must not become `?action=` on the request, which the API rejects as a malformed filter
    rather than ignoring.
  */
  const query: AuditQuery = {
    ...(tenantId === undefined ? {} : { tenant_id: tenantId }),
    ...(action === undefined ? {} : { action }),
    ...(actorId === undefined ? {} : { actor_id: actorId }),
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(cursor === undefined ? {} : { cursor }),
  }

  const page = await attempt(listAuditEvents(query))
  const rows: readonly AuditEvent[] = page.ok ? page.value.data : []

  const nameById = new Map(
    (clinics ?? []).map((clinic) => [clinic.id, clinic.trading_name ?? clinic.legal_name]),
  )

  const trail = tenantId === undefined
    ? 'Carevelo — the platform trail'
    : nameById.get(tenantId) ?? tenantId

  /* Whether anything NARROWS the trail, as opposed to choosing which one it is. The empty
     state turns on this: "no events" under a filter is a statement about the filter, and
     without one it is a statement about the trail itself. */
  const narrowed = [action, actorId, from, to].some((value) => value !== undefined)

  /* The filters currently in force, for every link that has to preserve them: the pager,
     and the "clear" action in the empty state. Written once so a new filter cannot be
     added to the form and forgotten by the pager, which would silently reset it on the
     second page. */
  const inForce = { tenant_id: tenantId, action, actor_id: actorId, from, to }

  return (
    <>
      <PageHeader
        title="Audit"
        description="What happened, to which clinic, by whom, and when."
        actions={
          <Badge tone={tenantId === undefined ? 'info' : 'warn'}>
            {tenantId === undefined ? 'Platform trail' : 'Clinic trail'}
          </Badge>
        }
      />

      <Stack gap="6">
        <Inline gap="3">
          <a className="lnk" href={paths.overview}>
            Platform overview
          </a>
          <a className="lnk" href={paths.breakGlass}>
            Break-glass register
          </a>
        </Inline>

        {/*
          The standing disclosure, above the table rather than under it: it is the answer to
          the question an operator is about to ask, which is "why is this column empty".
          Not dismissible.
        */}
        <Notice tone="info" icon="shield" title="What this register shows, and what it withholds">
          Carevelo&rsquo;s own events come back in full. A clinic&rsquo;s events come back as
          metadata only — that something happened, to which clinic, by which actor, of what
          kind, and when. The payload, the record that was touched, and the staff
          member&rsquo;s address and device are withheld by the API and are not hidden here:
          they are not in the response. Record-level detail is what a{' '}
          <a className="lnk" href={paths.breakGlass}>
            break-glass grant
          </a>{' '}
          is for, and that is reason-recorded, time-boxed, told to the clinic and audited.
        </Notice>

        <Notice tone="info" icon="activity" title="Reading this is itself audited">
          Opening this screen writes an entry naming you, the filters you used and the clinic
          whose trail you read. That is on purpose: an audit log with a blind spot where an
          insider would look is not evidence of anything.
        </Notice>

        {/* ---- Choosing the trail, and narrowing it. A GET, so the result is a URL that can
                be reloaded, bookmarked, or sent to somebody during an incident. ---- */}
        <Card as="section" padding="tight">
          <Toolbar
            label="Choose which audit trail to read and narrow it"
            as="form"
            method="get"
            action={paths.register}
            actions={
              <Button type="submit" variant="quiet">
                Read
              </Button>
            }
          >
            {clinics === null ? (
              <Field
                name="tenant_id"
                label="Clinic identifier"
                hint="The clinic register did not answer, so this is asking for the identifier directly. Leave it empty for Carevelo's own trail."
              >
                {(control) => (
                  <Input {...control} type="text" defaultValue={tenantId ?? ''} autoComplete="off" spellCheck={false} />
                )}
              </Field>
            ) : (
              <Field
                name="tenant_id"
                label="Trail"
                hint={
                  clinicsComplete
                    ? undefined
                    : 'Only the first page of the register is listed — the endpoint offers no search.'
                }
              >
                {(control) => (
                  <Select {...control} defaultValue={tenantId ?? ''}>
                    <option value="">Carevelo (platform events)</option>
                    {clinics.map((clinic) => (
                      <option key={clinic.id} value={clinic.id}>
                        {clinic.trading_name ?? clinic.legal_name} ({clinic.subdomain})
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}

            <Field
              name="action"
              label="Action"
              hint="Exactly, as it is recorded: break_glass.granted"
            >
              {(control) => (
                <Input {...control} type="text" defaultValue={action ?? ''} autoComplete="off" spellCheck={false} />
              )}
            </Field>

            <Field name="actor_id" label="Actor">
              {(control) => (
                <Input {...control} type="text" defaultValue={actorId ?? ''} autoComplete="off" spellCheck={false} />
              )}
            </Field>

            {/* Days, not instants, and inclusive at both ends. The API resolves them in
                Africa/Kampala — the operator's own day — rather than in UTC, which would
                move the first and last three hours of every day into the wrong one. */}
            <Field name="from" label="From">
              {(control) => <Input {...control} type="date" defaultValue={from ?? ''} />}
            </Field>

            <Field name="to" label="To">
              {(control) => <Input {...control} type="date" defaultValue={to ?? ''} />}
            </Field>
          </Toolbar>
        </Card>

        {!page.ok ? (
          /*
            A failed read is NOT an empty list, and the distinction is the whole reason this
            is a Notice and not an EmptyState. "Nothing happened at this clinic" is a
            conclusion somebody might act on during an incident; "we could not ask" is not.
          */
          <Notice tone="bad" icon="activity" title="The register could not be read">
            {page.message
              ?? 'The request to /v1/platform/audit-events did not complete. Nothing follows '
                + 'from that about what is or is not in the trail — only that this screen '
                + 'could not ask.'}
          </Notice>
        ) : (
          <Card as="section" padding="tight">
            <DataTable
              caption={
                `${rows.length} event${rows.length === 1 ? '' : 's'} from ${trail}, newest first.`
                + ' Paged by cursor, because reading this trail also writes to it.'
              }
              rows={rows}
              rowKey={(row) => row.id}
              empty={
                <EmptyState
                  icon="file"
                  title={narrowed ? 'Nothing matches those filters' : `Nothing recorded in ${trail}`}
                  action={
                    narrowed ? (
                      <Button variant="quiet" href={href(paths.register, { tenant_id: tenantId })}>
                        Clear the filters
                      </Button>
                    ) : undefined
                  }
                >
                  {narrowed
                    ? 'That is a statement about the filters, not about the trail. Clear them '
                      + 'to see everything recorded here.'
                    : 'No event has been written to this trail. An audit trail is written by '
                      + 'the system as things happen, so an empty one means nothing has '
                      + 'happened yet — it is not a screen anybody can populate.'}
                </EmptyState>
              }
              columns={[
                {
                  key: 'action',
                  header: 'Action',
                  /* The value that NAMES the row: a screen reader reading a cell hears
                     "break_glass.granted, When, 14 Aug 2026 09:12" rather than a
                     disembodied timestamp. */
                  rowHeader: true,
                  cell: (row) => <code>{row.action}</code>,
                },
                {
                  key: 'when',
                  header: 'When',
                  /* UTC on the wire, Africa/Kampala on screen, and the component is the
                     only thing in the product allowed to make that conversion. */
                  cell: (row) => <DateTime value={row.occurred_at} format="datetime" />,
                },
                {
                  key: 'clinic',
                  header: 'Clinic',
                  cell: (row) =>
                    row.tenant_id === null ? (
                      <span className="muted">Carevelo</span>
                    ) : (
                      nameById.get(row.tenant_id) ?? <code>{row.tenant_id}</code>
                    ),
                },
                {
                  key: 'actor',
                  header: 'Actor',
                  cell: (row) => (
                    <Stack gap="1">
                      <span>{row.actor_role ?? row.actor_type}</span>
                      {row.actor_id === null ? null : (
                        <code className="muted">{row.actor_id}</code>
                      )}
                    </Stack>
                  ),
                },
                {
                  key: 'subject',
                  header: 'Subject',
                  cell: (row) => <Subject event={row} />,
                },
                {
                  key: 'detail',
                  header: 'Detail',
                  cell: (row) => <Detail event={row} />,
                },
              ]}
            />
          </Card>
        )}

        {/*
          BOTH CURSORS COME OFF THE RESPONSE, so neither control renders as a dead disabled
          button. Every filter in force is carried across, or the second page would silently
          be a page of something else.
        */}
        {page.ok ? (
          <Pagination
            label="Audit register pages"
            summary={`${rows.length} event${rows.length === 1 ? '' : 's'} on this page`}
            {...(page.value.meta.prev_cursor
              ? { previousHref: href(paths.register, { ...inForce, cursor: page.value.meta.prev_cursor }) }
              : {})}
            {...(page.value.meta.next_cursor
              ? { nextHref: href(paths.register, { ...inForce, cursor: page.value.meta.next_cursor }) }
              : {})}
          />
        ) : null}
      </Stack>
    </>
  )
}

/**
 * A query parameter that was actually given.
 *
 * An empty string is what a form sends for a control nobody filled in, and it means the
 * same thing as an absent parameter everywhere on this screen. Collapsing the two here is
 * what lets the rest of the file test for `undefined` and be right.
 */
function present(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value.trim()
}

/**
 * What was acted on.
 *
 * A clinic's row keeps the KIND and loses the identifier, so this renders "Consultation"
 * and never which consultation. Written as its own component rather than inline because the
 * two branches are the projection rule made visible, and a reader of the column definition
 * above should be sent here to read it rather than shown a nested ternary.
 */
function Subject({ event }: { event: AuditEvent }) {
  if (event.subject_type === null) {
    return <span className="muted">—</span>
  }

  return (
    <Stack gap="1">
      <span>{event.subject_type}</span>
      {event.subject_id === null ? null : <code className="muted">{event.subject_id}</code>}
    </Stack>
  )
}

/**
 * The payload, or the fact that there is one and it is not for us.
 *
 * "WITHHELD" IS A WORD AND NOT AN EMPTY CELL, which is the whole point of this component. A
 * blank in this column would read as "nothing happened beyond the action", and on a clinic's
 * trail that is false: something was recorded, and it belongs to a controller we process
 * for. Saying so is also what makes the rest of the register trustworthy — a reader who can
 * see where the line is drawn does not have to wonder whether it moves.
 */
function Detail({ event }: { event: AuditEvent }) {
  if (event.projection === 'metadata_only') {
    return (
      <Badge tone="neutral" icon="lock">
        Withheld
      </Badge>
    )
  }

  const pairs = metadataPairs(event)

  if (pairs.length === 0) {
    return <span className="muted">—</span>
  }

  return (
    <Stack gap="1">
      {pairs.map((pair) => (
        <span key={pair.key} className="muted">
          {pair.key}: {pair.value}
        </span>
      ))}
    </Stack>
  )
}
