import {
  Button,
  Card,
  DataTable,
  DateTime,
  EmptyState,
  Field,
  Inline,
  Notice,
  PageHeader,
  Pagination,
  Select,
  Stack,
  Toolbar,
} from '@carevelo/ui'
import { attempt, type Capabilities } from '@/domains/identity'
import { listTenants } from '../api/tenants'
import { href } from '../model/links'
import { STATUSES, knownStatus } from '../model/status'
import type { PlatformPaths, TenantStatus } from '../model/types'
import { StatusBadge } from './StatusBadge'
import { TenantPanel } from './TenantPanel'

/**
 * The register of clinics on Carevelo, and their lifecycle.
 *
 * ============================================================
 * WHAT IS NOT ON THIS SCREEN IS THE DESIGN
 * ============================================================
 *
 * No patient count. No consultation count. No revenue. No aggregator credentials. Not
 * hidden from this table — absent from `PlatformTenantResource`, which carries status,
 * trial, attestations and contact and stops there.
 *
 * The register says so out loud, once, in a standing notice. An operator who does not know
 * that a figure is deliberately unavailable will go looking for it in a database, and the
 * point of a control plane that cannot answer clinical questions is lost the moment
 * somebody starts answering them another way. docs/40-api/openapi.yaml puts it in one line:
 * "What support can answer from here: is this clinic provisioned, on trial, suspended,
 * offboarding. What it cannot answer from anywhere: anything about a patient."
 *
 * ============================================================
 * READ-ONLY IS A ROLE, NOT A DISABLED BUTTON
 * ============================================================
 *
 * `platform_support` may read this register and may not change anything on it
 * (docs/50-security-compliance/rbac-matrix.md § Administration). The provisioning and
 * lifecycle controls are therefore ABSENT for that role rather than present and disabled,
 * and a notice says which role they need. A disabled control invites somebody to find out
 * why; an absent one with an explanation does not.
 *
 * ============================================================
 * CURSOR PAGINATION, AND NO SEARCH BECAUSE THERE IS NO SEARCH
 * ============================================================
 *
 * The index accepts `status`, `per_page` and `cursor`. There is no name, subdomain or id
 * filter, so this screen offers none: a search box that filtered the hundred rows already
 * fetched would find nothing on page two and would look exactly like a clinic that is not
 * on Carevelo. Reported as a gap instead.
 *
 * Cursor rather than offset because clinics are provisioned and suspended while somebody
 * pages through, which is exactly the traffic under which an offset duplicates and skips
 * rows.
 *
 * ============================================================
 * THE TABLE IS A `DataTable` NOW, AND THE MARKUP IT REPLACED WAS ALREADY GOOD
 * ============================================================
 *
 * That is worth saying plainly, because "we replaced it with the component" usually means
 * something was wrong. This was a real `<table>` in a real `.table-scroll` and all six
 * `<th>` carried `scope="col"`. What the component adds is the three things a person leaves
 * out at four in the afternoon, made structurally impossible rather than remembered:
 *
 *  - The CLINIC column is now `<th scope="row">`. It is the value that names the row, so a
 *    screen reader says "Kabalagala Medical Centre, State, active" instead of announcing a
 *    lifecycle state with nothing attached to it. A table read cell by cell with no row
 *    name is a table of disembodied values, and this one has a suspended clinic in it.
 *  - The action column's heading was an empty-looking `<th>` carrying an `sr-only` span.
 *    `headerHidden` says the same thing in the type, so it cannot be written as a genuinely
 *    empty `<th>` by the next person copying the row above it.
 *  - `.table-scroll` takes `tabIndex={0}`, a `role="region"` and the caption as its name.
 *    A region that scrolls sideways and cannot be focused cannot be scrolled by anybody who
 *    is not holding a mouse, and this table is six columns wide.
 *
 * `empty` is required, which also collapsed a branch: the screen used to choose between an
 * `EmptyState` and a table, so the headings and the caption vanished when a filter matched
 * nothing and the page changed shape under the reader. Now the table keeps its shape and
 * the empty state renders inside it.
 */
export type TenantRegisterScreenProps = {
  can: Capabilities
  paths: PlatformPaths
  /** `?status=` — one of the five states, or absent for all of them. */
  status?: string | undefined
  /** `?cursor=` — opaque, straight from `meta.next_cursor`. Never constructed here. */
  cursor?: string | undefined
  /** `?tenant=` — whose panel is open. Only ever a clinic on the page in view; see TenantPanel. */
  tenant?: string | undefined
  /** `?problem=` and `?message=` — what the last write did, and the API's own sentence. */
  problem?: string | undefined
  message?: string | undefined
  /** `?provisioned=` — the subdomain of a clinic just created, for the confirmation. */
  provisioned?: string | undefined
}

export async function TenantRegisterScreen({
  can,
  paths,
  status,
  cursor,
  tenant,
  problem,
  message,
  provisioned,
}: TenantRegisterScreenProps) {
  // A `<select>` with nothing chosen posts an EMPTY STRING rather than an absent parameter,
  // and an unknown value in a hand-edited URL must mean "all" rather than "none" — a filter
  // nobody chose should never hide a suspended clinic. Normalised once, here.
  const filter: TenantStatus | undefined = knownStatus(status ?? '') ?? undefined

  const page = await attempt(
    listTenants({
      ...(filter === undefined ? {} : { status: filter }),
      ...(cursor === undefined || cursor === '' ? {} : { cursor }),
    }),
  )

  const rows = page.ok ? page.value.data : []
  const open = tenant === undefined ? undefined : rows.find((row) => row.id === tenant)

  return (
    <>
      <PageHeader
        title="Tenants"
        description="The register of clinics on Carevelo, and their lifecycle."
        actions={
          can.provision ? (
            <Button variant="primary" href={paths.provision}>
              Provision a clinic
            </Button>
          ) : undefined
        }
      />

      <Stack gap="6">
        <Inline gap="3">
          <a className="lnk" href={paths.overview}>
            Platform overview
          </a>
        </Inline>

        {provisioned ? (
          <Notice tone="info" icon="check" title="Clinic provisioned">
            <code>{provisioned}</code> now exists, in <code>provisioning</code>. It is not
            open for business and no control here opens it: the clinic completes its own
            checklist — branding, at least one bookable service, at least one clinician,
            consent text, its own mobile-money account — and becomes active that way.
          </Notice>
        ) : null}

        <Outcome problem={problem} message={message} />

        {/*
          The standing disclosure. Not dismissible, and deliberately above the table rather
          than under it: it is the answer to the question an operator is about to ask.
        */}
        <Notice tone="info" icon="shield" title="What this register can and cannot answer">
          Administration only. A clinic&rsquo;s patients, consultations and prescriptions are
          not reachable from this screen, and there is no patient count, consultation count,
          revenue figure or aggregator credential on any platform endpoint — none of those
          are hidden here, they do not exist in the resource. The only path across that line
          is a break-glass grant, which is a different screen precisely so that taking it is
          a deliberate act.
        </Notice>

        {!can.changeLifecycle ? (
          <Notice tone="info" icon="lock" title="Read-only">
            Your platform role reads this register and requests break-glass grants.
            Provisioning, suspension, resumption and export need <code>platform_admin</code>,
            so those controls are not on this screen at all rather than present and
            refusing.
          </Notice>
        ) : null}

        {/* ---- Narrowing by state. A GET, so the result is a URL that can be reloaded,
                bookmarked or sent to somebody during an incident. ---- */}
        {/*
          A `Toolbar as="form" method="get"`, which is what this already was and now says so.

          The `<div class="field">` here was hand-rolled — a label, an htmlFor and an id
          typed out at the call site — and it was the only raw form control left in either of
          these two apps. `Field` owns that wiring, which is the point of it: the four
          attributes that must agree do agree, once, in one file, and a page still LOOKS
          correct when one of them is wrong.

          What the Toolbar itself adds is a name. A bare `<div>` of one `<select>` and one
          button has no accessible name at all, so a screen-reader user landing on the
          control hears "State, combo box" with nothing to say what it filters — and this
          page can have two such groups on it once the panel is open. Deliberately NOT
          `role="toolbar"`: that role promises arrow-key navigation between the controls,
          which needs client JavaScript this surface does not ship.

          No hidden cursor. Changing the filter must start the list again: a cursor belongs
          to the query that produced it, and carrying one across a filter change pages into
          a set that no longer exists.
        */}
        <Card as="section" padding="tight">
          <Toolbar
            label="Filter the clinic register by lifecycle state"
            as="form"
            method="get"
            action={paths.register}
            actions={
              <Button type="submit" variant="quiet">
                Filter
              </Button>
            }
          >
            <Field name="status" label="State">
              {(control) => (
                <Select {...control} defaultValue={filter ?? ''}>
                  <option value="">Every state</option>
                  {STATUSES.map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </Toolbar>
        </Card>

        {/* The panel sits ABOVE the table so that opening a clinic does not send the
            operator scrolling for what they just clicked. */}
        {open ? (
          <TenantPanel
            tenant={open}
            can={can}
            paths={paths}
            status={filter}
            cursor={cursor}
          />
        ) : tenant !== undefined ? (
          <Notice tone="warn" icon="help" title="That clinic is not on this page">
            The API publishes no endpoint that fetches one clinic by id — index, provision,
            update and export, and no show — so a panel can only open for a row already
            loaded. Clear the filter or page to the clinic you want. This is a gap in the
            contract, not a setting.
          </Notice>
        ) : null}

        {/* ---- The register itself ---- */}
        {!page.ok ? (
          <Notice tone="bad" icon="activity" title="The register could not be read">
            {page.message
              ?? 'The request to /v1/platform/tenants did not complete. Nothing follows from '
                + 'that about any clinic — only that this screen could not ask.'}
          </Notice>
        ) : (
          <Card as="section" padding="tight">
            <DataTable
              caption={
                `${rows.length} clinic${rows.length === 1 ? '' : 's'} on this page`
                + `${filter ? `, in ${filter}` : ''}. Paged by cursor, so the list stays `
                + 'consistent while clinics are being provisioned beside it.'
              }
              rows={rows}
              rowKey={(row) => row.id}
              /*
                RENDERED INSIDE THE TABLE, so the headings and the caption stay put and the
                page does not change shape between a full register and an empty one. It also
                keeps the distinction the screen has always drawn and must keep drawing:
                "no clinic is in `suspended`" is a statement about the FILTER, and "no
                clinics on the register" is a statement about Carevelo. A bare "No results"
                would be ambiguous between them, and only one of the two needs anybody to do
                anything.
              */
              empty={
                <EmptyState
                  icon="users"
                  title={filter ? `No clinic is in ${filter}` : 'No clinics on the register'}
                  action={
                    filter ? (
                      <Button variant="quiet" href={paths.register}>
                        Show every state
                      </Button>
                    ) : undefined
                  }
                >
                  {filter
                    ? 'That is a statement about this filter, not about Carevelo. Clear it '
                      + 'to see every clinic.'
                    : 'Nothing has been provisioned yet.'}
                </EmptyState>
              }
              columns={[
                {
                  key: 'clinic',
                  header: 'Clinic',
                  /* The value that NAMES the row — see the note at the top of this file. */
                  rowHeader: true,
                  cell: (row) => (
                    <Stack gap="1">
                      <strong>{row.trading_name ?? row.legal_name}</strong>
                      {/*
                        `.muted` alone, where this was `.muted` plus a hand-set 12.5px. The
                        size was the only thing separating it from the name above it, and
                        `.table tbody th` already sets that name at weight 550 — so the
                        weight does the separating and the second line stays at reading
                        size. --ink-muted on --canvas is 5.09:1; the 12.5px version was the
                        same colour two steps smaller, which is how a legal name becomes
                        unreadable rather than merely secondary.
                      */}
                      {row.trading_name ? (
                        <span className="muted">{row.legal_name}</span>
                      ) : null}
                    </Stack>
                  ),
                },
                {
                  key: 'subdomain',
                  header: 'Subdomain',
                  cell: (row) => <code>{row.subdomain}</code>,
                },
                {
                  key: 'state',
                  header: 'State',
                  cell: (row) => <StatusBadge status={row.status} />,
                },
                {
                  key: 'trial',
                  header: 'Trial ends',
                  cell: (row) =>
                    row.trial_ends_at ? (
                      <DateTime value={row.trial_ends_at} />
                    ) : (
                      <span className="muted">—</span>
                    ),
                },
                {
                  key: 'district',
                  header: 'District',
                  cell: (row) => row.district ?? <span className="muted">—</span>,
                },
                {
                  key: 'open',
                  /*
                    The heading is real and hidden, not absent. An empty `<th>` announces as
                    silence, so a keyboard user landing in this column has no name for where
                    they are. The link's own name carries the clinic for the same reason a
                    row of identical "Open" links is no use read out of context.
                  */
                  header: 'Open this clinic',
                  headerHidden: true,
                  cell: (row) => (
                    <a
                      className="lnk"
                      href={href(paths.register, {
                        status: filter,
                        cursor,
                        tenant: row.id,
                      })}
                      aria-label={`Open ${row.trading_name ?? row.legal_name}`}
                    >
                      Open
                    </a>
                  ),
                },
              ]}
            />
          </Card>
        )}

        {/*
          BOTH CURSORS EXIST HERE, which is why this screen gets the real pager and the
          rider's assignment list does not: `meta.prev_cursor` and `meta.next_cursor` both
          come off the response, so neither control renders as a dead disabled button.
          Pagination cannot render "page 3 of 12" and has no prop that would accept an
          offset — which is the property that matters, because clinics are provisioned and
          suspended while somebody reads this, and an offset under that traffic duplicates
          and skips rows.
        */}
        {page.ok ? (
          <Pagination
            label="Clinic register pages"
            summary={`${rows.length} clinic${rows.length === 1 ? '' : 's'} on this page`}
            {...(page.value.meta.prev_cursor
              ? {
                  previousHref: href(paths.register, {
                    status: filter,
                    cursor: page.value.meta.prev_cursor,
                  }),
                }
              : {})}
            {...(page.value.meta.next_cursor
              ? {
                  nextHref: href(paths.register, {
                    status: filter,
                    cursor: page.value.meta.next_cursor,
                  }),
                }
              : {})}
          />
        ) : null}
      </Stack>
    </>
  )
}

/**
 * What the last write had to say about itself.
 *
 * THE API'S OWN SENTENCE, UNCHANGED, wherever there is one. A refused lifecycle move is the
 * interesting case: the API knows which transitions are legal and this screen deliberately
 * does not, so its refusal is the only accurate explanation available and a paraphrase here
 * would lose the part the operator can act on.
 */
function Outcome({ problem, message }: { problem?: string | undefined; message?: string | undefined }) {
  if (problem === undefined || problem === '') {
    return null
  }

  if (problem === 'incomplete') {
    return (
      <Notice tone="warn" title="Nothing was submitted">
        The form was sent without a choice on it, so nothing was changed.
      </Notice>
    )
  }

  if (problem === 'not_found') {
    return (
      <Notice tone="warn" icon="help" title="That clinic is not there">
        Most likely a register left open while somebody else changed it. Reload the list.
      </Notice>
    )
  }

  if (problem === 'refused') {
    return (
      <Notice tone="warn" icon="lock" title="Refused">
        {message ?? 'The API refused this change for this account.'}
      </Notice>
    )
  }

  if (problem === 'export_failed') {
    return (
      <Notice tone="bad" title="The export did not complete">
        {message
          ?? 'The export request did not complete. Nothing was withheld deliberately — the '
            + 'endpoint has no status check and never refuses on commercial grounds.'}
      </Notice>
    )
  }

  return (
    <Notice tone="bad" title="That change was not applied">
      {message ?? 'The request did not complete, and the API gave no reason this screen can pass on.'}
    </Notice>
  )
}
