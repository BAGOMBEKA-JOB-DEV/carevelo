import { Button, Card, DateTime, Grid, Inline, Notice, PageHeader, Stack, Stat } from '@carevelo/ui'
import { attempt } from '@/domains/identity'
import { getHealth } from '../api/health'
import { isolation, tenantCounts } from '../model/health'
import { STATUSES } from '../model/status'
import type { Health, PlatformPaths } from '../model/types'

/**
 * The landing screen: what the platform looks like right now, and where to go.
 *
 * ============================================================
 * THE BREAK-GLASS COUNT IS THE HEADLINE, AND ITS FRAMING IS THE WHOLE POINT
 * ============================================================
 *
 * `GET /v1/platform/health` returns `break_glass.active_grants`, and the contract explains
 * why it is on the health endpoint at all rather than buried in the grant register:
 * "Surfaced next to uptime on purpose. A rising number of live grants means the
 * metadata-based support tooling is INADEQUATE, not that more access is needed, and a
 * figure nobody sees is a figure nobody acts on."
 *
 * docs/50-security-compliance/rbac-matrix.md says the same thing twice, and the second time
 * it names the correct response: "A rising count means the support tooling is inadequate,
 * not that access is needed — the correct response is to build better metadata-based
 * diagnosis."
 *
 * So the number is large, it is first, and the sentence beside it is that sentence. A
 * dashboard that showed this as "3 active grants ✓" would be reporting a control working
 * when what it is actually reporting is a support tool that cannot answer a question
 * without reading somebody's medical record.
 *
 * ============================================================
 * WHY THERE IS NO BILLING PANEL ON THIS PAGE OR ANY OTHER
 * ============================================================
 *
 * There is no subscription, plan, price, invoice or payment model anywhere in
 * docs/40-api/openapi.yaml for a tenant. `UpdateTenantRequest` carries `status` and
 * `trial_ends_at` and its own description says why: "COMMERCIAL fields only." The tenant
 * counts below and the trial date on each clinic ARE the commercial surface, in full.
 *
 * A revenue tile here would have to be invented, and an invented figure on a control plane
 * is worse than no figure: somebody would eventually act on it.
 *
 * ============================================================
 * SERVER-RENDERED, AND IT SAYS WHEN IT LOOKED
 * ============================================================
 *
 * No socket and no polling. docs/30-architecture/frontend-nextjs.md is explicit that
 * platform admin subscribes to nothing tenant-scoped, and there is no platform channel to
 * subscribe to. That is also the right shape for these figures: they are read as a trend
 * across weeks in a periodic review, not watched as a dial, and a number that changes
 * quietly under the reader is a number nobody can cite. `checked_at` is rendered so the
 * page is a dated snapshot rather than an implied live view.
 *
 * ============================================================
 * THE HEADLINE FIGURE IS A `Stat` NOW, AND IT USED TO BE `fontSize: 44` BY HAND
 * ============================================================
 *
 * Two things follow from moving it into the component, and the second is the one that
 * mattered. The size is decided by the type scale rather than by a number typed on this
 * screen — `.stat__value` is the display face at 28px with tabular figures — so this figure
 * and the same figure on the break-glass screen can no longer disagree about how important
 * they are, which they did: both were hand-set to 44 in two different files and either could
 * have been edited alone.
 *
 * And the LABEL PRECEDES THE VALUE, by construction, because the component's props cannot
 * reorder them. A bare "3" announced on its own is a screen-reader user's dead end. That is
 * not hypothetical on this screen: the count is the most consequential number in the app,
 * and it means the opposite of what a number on a dashboard usually means.
 *
 * The stat and the paragraph that frames it sit in a `Grid cols={2}`, which collapses to one
 * column at 700px. That replaces a `minWidth: 260` on the paragraph, which was doing the
 * same job by hand and only approximately: a flex child with a minimum width wraps when it
 * runs out of room, but nothing said what "enough room" was except that number.
 */
export async function OverviewScreen({ paths }: { paths: PlatformPaths }) {
  const health = await attempt(getHealth())

  return (
    <>
      <PageHeader
        title="Platform overview"
        description={
          <>
            Carevelo&rsquo;s own control plane. It administers clinics and reaches none of
            their clinical data — the single exception is a break-glass grant, which is a
            different screen precisely so that taking it is a deliberate act.
          </>
        }
        /*
          NOT a `Stat`. The instant this page was read is a caveat about the figures below
          it, not one of them — `.stat__value` is a 28px display figure and a timestamp set
          at that size would read as the most important number on the screen, which is
          exactly backwards. It is a muted line beside the title, where a dateline goes.
        */
        actions={
          health.ok ? (
            <span className="muted">
              Checked <DateTime value={health.value.checked_at} format="datetime" />
            </span>
          ) : undefined
        }
      />

      {!health.ok ? (
        <Notice tone="bad" icon="activity" title="Health could not be read">
          {health.message
            ?? 'The request to /v1/platform/health did not complete. Nothing can be '
              + 'concluded from that about the platform itself — only that this screen '
              + 'could not ask.'}
        </Notice>
      ) : (
        <Stack gap="6">
          {/* ---- The headline. See the note at the top of this file. ---- */}
          <Card as="section" aria-label="Break-glass grants live now">
            <Stack gap="5">
              <Grid cols={2} gap="6">
                <Stat
                  label="Break-glass grants live now"
                  value={health.value.break_glass.active_grants}
                />
                <p className="muted">
                  Read this as a measure of the SUPPORT TOOLING, not of access control. A
                  rising count means ordinary metadata-based diagnosis is inadequate and the
                  correct response is to build better diagnosis — not to conclude that
                  break-glass is working well.
                </p>
              </Grid>

              <Inline gap="3">
                <Button variant="primary" href={paths.breakGlass}>
                  Break-glass register
                </Button>
              </Inline>
            </Stack>
          </Card>

          {/* ---- The one security assertion this endpoint makes. ---- */}
          <IsolationCard database={health.value.database} />

          {/* ---- Clinics by state. This is the commercial surface, in full. ---- */}
          <Card as="section" aria-labelledby="overview-tenants">
            <Stack gap="5">
              <h2 id="overview-tenants">Clinics by state</h2>

              {/*
                `Inline` and not `Grid`, because the number of states is not fixed. There
                are five today and `knownStatus()` exists precisely because the API may grow
                a sixth before this build hears about it — `Grid` takes a column count and
                would have to be told, in this file, a fact only the API knows. A wrapping
                row takes however many arrive.
              */}
              <Inline gap="7" align="start">
                {tenantCounts(health.value.tenants, STATUSES).map((row) => (
                  <Stat
                    key={row.status}
                    label={row.status}
                    value={row.count}
                    note={row.recognised ? undefined : 'a state this build does not know'}
                  />
                ))}
              </Inline>

              <p className="muted">
                Counts only. No patient numbers, no consultation numbers and no revenue —
                none of those exist on any platform endpoint, and the state above plus each
                clinic&rsquo;s trial date is the whole of the commercial picture this
                product has.
              </p>

              <Inline gap="3">
                <Button variant="quiet" href={paths.register}>
                  Tenant register
                </Button>
              </Inline>
            </Stack>
          </Card>
        </Stack>
      )}
    </>
  )
}

/**
 * Row-level security, reported rather than assumed.
 *
 * RLS is the layer that holds when the ability check and the policy check both have a bug —
 * docs/40-api/authentication-and-sessions.md calls it the control and the other two "good
 * error messages" — so `isolation_enforced` coming back false is the most serious single
 * fact this app can display, and it gets the `bad` tone and an announcement.
 *
 * The contract types the field as a boolean on one branch of a union and a string on the
 * other, which is a spec defect. `isolation()` refuses to guess at an unrecognised value
 * and this renders the raw text instead of picking a side: a green tick derived from the
 * string "false" is precisely the failure that would matter most.
 */
function IsolationCard({ database }: { database: Health['database'] }) {
  const state = isolation(database)

  if (!state.known) {
    return (
      <Notice tone="warn" icon="shield" title="Tenant isolation: unrecognised answer">
        The API reported <code>{state.raw}</code>, which this build cannot read as yes or no.
        The field is typed two ways in the published contract — boolean on one branch,
        string on the other — so nothing is concluded from it here. Treat the state of
        row-level security as unknown until the contract is fixed.
      </Notice>
    )
  }

  if (!state.enforced) {
    return (
      <Notice tone="bad" icon="shield" title="Tenant isolation is NOT enforced">
        PostgreSQL row-level security is the layer that holds when the ability check and the
        policy check both have a bug. With it off, one clinic&rsquo;s rows are reachable
        from another clinic&rsquo;s session if anything above it is wrong. This is an
        incident, not a warning.
        {database.role ? <> Database role: <code>{database.role}</code>.</> : null}
      </Notice>
    )
  }

  return (
    <Notice tone="info" icon="shield" title="Tenant isolation is enforced">
      Row-level security is on, so the database returns nothing outside a session&rsquo;s
      tenant regardless of what the ability and policy checks concluded.
      {database.role ? <> Database role: <code>{database.role}</code>.</> : null}
    </Notice>
  )
}
