import { Button, Card, DateTime, Notice } from '@carevelo/ui'
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
 */
export async function OverviewScreen({ paths }: { paths: PlatformPaths }) {
  const health = await attempt(getHealth())

  return (
    <>
      <div className="page-head">
        <div className="grow">
          <h1>Platform overview</h1>
          <p>
            Carevelo&rsquo;s own control plane. It administers clinics and reaches none of
            their clinical data — the single exception is a break-glass grant, which is a
            different screen precisely so that taking it is a deliberate act.
          </p>
        </div>
        {health.ok ? (
          <span className="stat">
            <span className="stat__label">Checked</span>
            <span className="stat__note">
              <DateTime value={health.value.checked_at} format="datetime" />
            </span>
          </span>
        ) : null}
      </div>

      {!health.ok ? (
        <div className="grid">
          <Notice tone="bad" icon="activity" title="Health could not be read">
            {health.message
              ?? 'The request to /v1/platform/health did not complete. Nothing can be '
                + 'concluded from that about the platform itself — only that this screen '
                + 'could not ask.'}
          </Notice>
        </div>
      ) : (
        <div className="grid">
          {/* ---- The headline. See the note at the top of this file. ---- */}
          <Card as="section" aria-labelledby="overview-break-glass">
            <div className="stack" style={{ gap: 'var(--space-5)' }}>
              <div className="row-wrap" style={{ gap: 'var(--space-8)' }}>
                <span className="stat">
                  <span className="stat__label" id="overview-break-glass">
                    Break-glass grants live now
                  </span>
                  <span className="stat__value" style={{ fontSize: 44 }}>
                    {health.value.break_glass.active_grants}
                  </span>
                </span>
                <div className="grow" style={{ minWidth: 260 }}>
                  <p className="muted">
                    Read this as a measure of the SUPPORT TOOLING, not of access control. A
                    rising count means ordinary metadata-based diagnosis is inadequate and
                    the correct response is to build better diagnosis — not to conclude that
                    break-glass is working well.
                  </p>
                </div>
              </div>

              <div className="row-wrap">
                <Button variant="primary" href={paths.breakGlass}>
                  Break-glass register
                </Button>
              </div>
            </div>
          </Card>

          {/* ---- The one security assertion this endpoint makes. ---- */}
          <IsolationCard database={health.value.database} />

          {/* ---- Clinics by state. This is the commercial surface, in full. ---- */}
          <Card as="section" aria-labelledby="overview-tenants">
            <div className="stack" style={{ gap: 'var(--space-5)' }}>
              <h2 id="overview-tenants">Clinics by state</h2>

              <div className="row-wrap" style={{ gap: 'var(--space-8)' }}>
                {tenantCounts(health.value.tenants, STATUSES).map((row) => (
                  <span className="stat" key={row.status}>
                    <span className="stat__label">{row.status}</span>
                    <span className="stat__value">{row.count}</span>
                    {!row.recognised ? (
                      <span className="stat__note">a state this build does not know</span>
                    ) : null}
                  </span>
                ))}
              </div>

              <p className="muted">
                Counts only. No patient numbers, no consultation numbers and no revenue —
                none of those exist on any platform endpoint, and the state above plus each
                clinic&rsquo;s trial date is the whole of the commercial picture this
                product has.
              </p>

              <div className="row-wrap">
                <Button variant="quiet" href={paths.register}>
                  Tenant register
                </Button>
              </div>
            </div>
          </Card>
        </div>
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
