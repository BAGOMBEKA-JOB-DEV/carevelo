import { redirect } from 'next/navigation'
import { Button, Card, Choice, DateTime, Field, Notice, Select } from '@carevelo/ui'
import type { Capabilities } from '@/domains/identity'
import { updateTenant } from '../api/tenants'
import { href } from '../model/links'
import { STATUSES, STATUS_MEANING, knownStatus } from '../model/status'
import { TRIAL_OPTIONS, trialEndsAt } from '../model/trial'
import type { PlatformPaths, Tenant, TenantStatus } from '../model/types'
import { StatusBadge } from './StatusBadge'

/**
 * One clinic, opened from the register: what Carevelo holds about it, and the three things
 * an administrator may do to it.
 *
 * ============================================================
 * WHY THIS IS A PANEL ON THE REGISTER AND NOT ITS OWN ROUTE
 * ============================================================
 *
 * There is no `GET /v1/platform/tenants/{tenant}`. The contract publishes index, store,
 * update and export — and no show. A `/tenants/[tenant]` route would therefore have to
 * find its clinic by paging through the index until it matched, which is a table scan in a
 * browser: fine with four clinics, slow with two hundred, and silently wrong the moment the
 * row is on a page nobody fetched.
 *
 * So the panel renders from the row the register already loaded, and `?tenant=` selects it.
 * The consequence is stated on screen rather than hidden: the panel opens only for a clinic
 * on the page in view. It is reported as a contract gap, because the fix is one endpoint
 * and the workaround gets worse with every clinic Carevelo signs.
 *
 * ============================================================
 * THE LIFECYCLE CONTROL OFFERS EVERY STATE AND LETS THE API REFUSE
 * ============================================================
 *
 * `TenantStatus` on the API decides which moves are legal and throws otherwise. The
 * contract is explicit about why it is not restated: "a state machine with its transitions
 * restated in a form request has two definitions and one of them will drift." That argument
 * is stronger in a browser, which is further from the machine and updated separately.
 *
 * So this offers the five states, marks the current one, and shows the API's own sentence
 * when a move is refused. The cost is that an operator can choose something that will be
 * rejected. The alternative cost is a copy of the state machine here that silently
 * disagrees with the real one — and the failure mode of THAT is a legal transition the UI
 * refuses to offer, which nobody can debug from the screen.
 *
 * ============================================================
 * THERE IS NO REASON FIELD, AND ITS ABSENCE IS THE CONTRACT'S
 * ============================================================
 *
 * `UpdateTenantRequest` carries `status` and `trial_ends_at` and nothing else. A reason box
 * here would collect text that goes nowhere — the worst kind of control, because it teaches
 * an operator that they have recorded a justification when they have recorded nothing. The
 * platform audit trail records the act; that a suspension is commercial rather than
 * clinical is the product's rule and not a per-suspension judgement.
 */
export type TenantPanelProps = {
  tenant: Tenant
  can: Capabilities
  paths: PlatformPaths
  /** Carried through every redirect so the operator lands back on the page they were on. */
  status?: string | undefined
  cursor?: string | undefined
}

export function TenantPanel({ tenant, can, paths, status, cursor }: TenantPanelProps) {
  const current = knownStatus(tenant.status)

  /** Back to this exact panel, with whatever the write had to say about itself. */
  const back = (problem?: string, message?: string | null) =>
    href(paths.register, {
      status,
      cursor,
      tenant: tenant.id,
      problem,
      message: message ?? undefined,
    })

  async function changeLifecycle(formData: FormData) {
    'use server'

    /*
     * Nothing that arrives through a form is trusted. The shape is checked here — is this
     * one of the five states the contract names — and every fact about the world, above all
     * whether this particular move is legal from where the clinic is now, is settled by the
     * API. `tenant.id` is a CLOSURE VARIABLE and never a form field: Next encrypts the
     * variables an inline Server Action closes over, so the clinic being suspended cannot
     * be swapped for another one by editing the page.
     */
    const chosen = String(formData.get('status') ?? '')

    if (!STATUSES.includes(chosen as TenantStatus)) {
      return redirect(back('incomplete'))
    }

    const outcome = await updateTenant(tenant.id, { status: chosen as TenantStatus })

    if (outcome.kind === 'problem') {
      return redirect(back(outcome.problem, outcome.message))
    }

    return redirect(back())
  }

  async function changeTrial(formData: FormData) {
    'use server'

    const value = trialEndsAt(String(formData.get('trial') ?? ''))

    // `undefined` means "leave it alone", which is the default and not a submission worth
    // sending. `null` means "clear it", which is a real change and must not be filtered out
    // by a truthiness test — the reason trialEndsAt returns three values rather than two.
    if (value === undefined) {
      return redirect(back('incomplete'))
    }

    const outcome = await updateTenant(tenant.id, { trial_ends_at: value })

    if (outcome.kind === 'problem') {
      return redirect(back(outcome.problem, outcome.message))
    }

    return redirect(back())
  }

  return (
    <Card as="section" aria-labelledby="panel-heading">
      <div className="stack" style={{ gap: 'var(--space-7)' }}>
        <div className="row-wrap">
          <div className="grow">
            <h2 id="panel-heading">{tenant.trading_name ?? tenant.legal_name}</h2>
            <p className="muted">
              {tenant.legal_name} · {tenant.subdomain}
              {tenant.custom_domain ? ` · ${tenant.custom_domain}` : ''}
            </p>
          </div>
          <StatusBadge status={tenant.status} />
        </div>

        {current ? <p className="muted">{STATUS_MEANING[current]}</p> : null}

        {/* ---- What Carevelo holds, and what it deliberately does not ---- */}
        <div className="grid g-2">
          <div className="stack">
            <span className="stat__label">Contact</span>
            <p className="muted">
              {tenant.contact.phone ?? 'No phone recorded'}
              <br />
              {tenant.contact.email ?? 'No email recorded'}
              <br />
              {tenant.district ?? 'No district recorded'}
            </p>
          </div>

          <div className="stack">
            <span className="stat__label">Trial</span>
            <p className="muted">
              {tenant.trial_ends_at ? (
                <>
                  Ends <DateTime value={tenant.trial_ends_at} format="datetime" />
                </>
              ) : (
                'No trial date set.'
              )}
            </p>
            <span className="stat__label">On Carevelo since</span>
            <p className="muted">
              {tenant.created_at ? <DateTime value={tenant.created_at} /> : 'Not recorded'}
            </p>
          </div>
        </div>

        {/*
          RECORDED, NEVER VERIFIED, and this notice is not optional politeness. Carevelo has
          no access to the UMDPC, AHPC, Nurses & Midwives or NDA registers. The resource
          carries `verified_by_carevelo` and it is false; presenting an attestation as though
          it were a check would be false, and — if a patient or an operator relied on it —
          harmful. Support fields questions about these references, which is the only reason
          they are on this screen at all.
        */}
        <Notice
          tone="warn"
          icon="shield"
          title={
            tenant.attestations.verified_by_carevelo
              ? 'Attestations — verified'
              : 'Attestations — recorded by the clinic, NOT verified by Carevelo'
          }
        >
          UMDPC facility reference:{' '}
          <code>{tenant.attestations.umdpc_facility_reference ?? 'none given'}</code>. NDA
          pharmacy licence reference:{' '}
          <code>{tenant.attestations.nda_licence_reference ?? 'none given'}</code>. Carevelo
          holds no access to those registers and cannot check either value.
        </Notice>

        {!can.changeLifecycle ? (
          <Notice tone="info" icon="lock" title="Read-only on this register">
            Your platform role can read the register and request a break-glass grant. It
            cannot provision, suspend, resume or export — those need{' '}
            <code>platform_admin</code>. The controls are absent rather than disabled so
            there is nothing here to press that would answer with a refusal.
          </Notice>
        ) : (
          <>
            {/* ---- Lifecycle ---- */}
            <form action={changeLifecycle} className="stack" style={{ gap: 'var(--space-5)' }}>
              <Choice
                name="status"
                legend="Move this clinic to"
                hint={
                  'Which moves are legal is the API’s decision, not this screen’s. '
                  + 'An unreachable move is refused in the API’s own words rather than '
                  + 'hidden by a copy of the state machine that would be free to drift.'
                }
                options={STATUSES.filter((state) => state !== current).map((state) => ({
                  value: state,
                  label: state,
                  note: STATUS_MEANING[state],
                }))}
                required
              />

              {/*
                Read this before pressing anything. Every clause is a thing that has been
                got wrong, in this product's own documents, at least once.
              */}
              <Notice tone="warn" icon="lock" title="What suspension does and does not do">
                It blocks staff sign-in. It does NOT stop a patient reading their own
                records, it does NOT abandon a delivery already in flight, and it can NEVER
                withhold the data export — the clinic is the data controller and leaves with
                its data regardless of any commercial dispute. A commercial dispute must not
                become a clinical incident.
              </Notice>

              <div className="row-wrap">
                <Button type="submit" variant="primary">
                  Apply this change
                </Button>
              </div>
            </form>

            {/* ---- The trial. The other half of the entire commercial surface. ---- */}
            <form action={changeTrial} className="stack" style={{ gap: 'var(--space-5)' }}>
              <Field
                name="trial"
                label="Trial"
                hint={
                  'The trial date and the lifecycle state are the whole commercial model. '
                  + 'There is no plan, no price and no invoice on any platform endpoint.'
                }
              >
                {(control) => (
                  <Select {...control} defaultValue="keep">
                    {TRIAL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <div className="row-wrap">
                <Button type="submit" variant="quiet">
                  Set the trial
                </Button>
              </div>
            </form>
          </>
        )}

        {/* ---- The controller-obligation export ---- */}
        {can.exportTenantData ? (
          <form
            method="post"
            action={paths.export}
            className="stack"
            style={{ gap: 'var(--space-4)' }}
          >
            {/*
              A NATIVE POST TO A ROUTE HANDLER, NOT A SERVER ACTION, AND NOT A LINK.

              Not a link, because this endpoint is audited twice — once in the platform trail
              and once in the CLINIC's own — so a GET that a browser prefetched or a crawler
              followed would write entries into a clinic's audit trail that nobody asked for.

              Not a Server Action, because an action cannot hand a file back to a browser
              that posted natively, and this surface ships no client JavaScript. The route
              handler answers with the export document as an attachment, which a plain form
              POST downloads without a line of script.
            */}
            <input type="hidden" name="tenant" value={tenant.id} />

            <h3>Controller-obligation export</h3>
            <p className="muted">
              The clinic&rsquo;s own data, as a file, for the clinic. Deliberately available
              in every state including suspended and offboarding — withholding it to secure
              payment would be unlawful and would harm patients. Aggregator credentials are
              not in it and the document says so: they are unreadable by every role including
              this one, and the clinic already holds them.
            </p>
            <p className="muted">
              Producing it writes to the platform audit trail and to this clinic&rsquo;s own,
              so the clinic can see that it happened even when somebody else asked for it.
            </p>

            <div className="row-wrap">
              <Button type="submit" variant="quiet">
                Produce the export
              </Button>
            </div>
          </form>
        ) : null}

        <div className="row-wrap">
          <a className="lnk" href={href(paths.register, { status, cursor })}>
            Close this clinic
          </a>
        </div>
      </div>
    </Card>
  )
}
