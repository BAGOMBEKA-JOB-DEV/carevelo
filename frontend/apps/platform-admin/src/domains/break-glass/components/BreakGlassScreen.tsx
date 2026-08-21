import { redirect } from 'next/navigation'
import {
  Button,
  Card,
  Choice,
  EmptyState,
  Field,
  Grid,
  Inline,
  Input,
  Notice,
  PageHeader,
  Pagination,
  Select,
  Stack,
  Stat,
  Textarea,
} from '@carevelo/ui'
import { attempt } from '@/domains/identity'
import type { Tenant } from '@/domains/platform'
import { listGrants, requestGrant } from '../api/grants'
import { SCOPES, isScope } from '../model/scopes'
import { WINDOWS, expiresAt } from '../model/window'
import type { BreakGlassPaths } from '../model/types'
import { GrantCard } from './GrantCard'

/**
 * ============================================================
 * BREAK-GLASS: the only route by which a Carevelo operator reaches a clinic's clinical data
 * ============================================================
 *
 * Each clinic is the data controller. Carevelo processes on instruction, and reading their
 * records without a reason is processing without one. Everything on this screen follows from
 * that single sentence.
 *
 * ------------------------------------------------------------
 * THE FOUR THINGS THIS SCREEN MUST GET RIGHT
 *
 * 1. REASON AND SCOPE ARE MANDATORY. Both are required by the contract and both are read
 *    months later by somebody who was not in the room. The scope picker names what each
 *    scope actually reaches, in ordinary words, and nothing is pre-selected — a
 *    pre-selected scope on an emergency form is a scope that gets submitted unread.
 *
 * 2. THE GRANT IS TIME-BOXED. A grant with no end is not a grant. The window is chosen as a
 *    LENGTH and the instant is computed on the server, because a datetime field posts a
 *    wall-clock string with no zone and can produce a grant that starts in the past —
 *    retrospective authorisation — entirely by accident. The shortest window is first and
 *    is the default: an operator who still needs access asks again, which writes a second
 *    audit entry, and that is the point rather than friction to design away.
 *
 * 3. THE TENANT IS ALWAYS NOTIFIED. The API issues the grant and notifies the clinic in one
 *    transaction — "There is no window in which access exists and the controller has not
 *    been told" — so there is nothing on this form to switch it off and nothing for an
 *    operator to remember. What this screen does is READ `tenant_notified_at` on every
 *    grant and say loudly when it is missing, because an unnotified grant permits nothing.
 *
 * 4. EVERY ACCESS IS AUDITED. Stated on the form, above the submit button, before the act
 *    rather than after it.
 *
 * ------------------------------------------------------------
 * THE COUNT IS THE HEADLINE, AND IT IS NOT A SUCCESS METRIC
 *
 * docs/50-security-compliance/rbac-matrix.md, twice: "A rising count means the SUPPORT
 * TOOLING is inadequate — not that access is needed", and "the correct response is to build
 * better metadata-based diagnosis". The number is therefore large, first, and carries that
 * sentence beside it. A dashboard that showed "3 active grants ✓" would be reporting a
 * control working when what it is reporting is a support tool that cannot answer a question
 * without reading somebody's medical record.
 *
 * The figure comes from `GET /v1/platform/health`, which is platform-wide and does not
 * depend on how anybody paged through the register. The route passes it in; when health
 * could not be read the screen falls back to counting the active grants in front of it and
 * says that is what it is doing.
 *
 * ------------------------------------------------------------
 * WHAT THIS SCREEN DOES INSTEAD OF A REVOKE BUTTON
 *
 * THERE IS NO REVOKE ENDPOINT IN THE PUBLISHED API, and this is deliberate rather than
 * missing: grants expire, they are not revoked. So this screen builds no revoke control, and
 * says so where an operator would look for one. What it offers in place of it is the thing
 * that is actually true — every live grant, its scope, its reason, and the instant it lapses
 * — so that an operator can see exactly what is open and how long it has left, and a
 * reviewer can count them.
 *
 * `revoked_at` is on the resource and is rendered where the API reports it. Nothing here can
 * set it. If ending a grant early becomes a requirement, it needs an endpoint; a button that
 * 404s during an incident would be worse than the honest absence.
 *
 * ------------------------------------------------------------
 * WHY THE CLINIC PICKER FALLS BACK TO A TEXT BOX
 *
 * `tenant_id` in a request body is the one legitimate exception in this API to "tenancy
 * never comes from the client", because a cross-tenant control surface has no host to read
 * it from. A mistyped id is therefore not a security hole — the policy grants the ability to
 * request, and the notification lands on the clinic named — it is a notification landing on
 * an innocent clinic. Which is why the picker lists real clinics.
 *
 * But this screen is used during an incident, and an incident is exactly when a dependency
 * is unwell. If the register cannot be read, the form degrades to a plain identifier field
 * rather than disappearing: a break-glass screen that cannot be used because a LIST failed
 * is a break-glass screen that is not there when it is needed.
 */
export type BreakGlassScreenProps = {
  paths: BreakGlassPaths
  /** Both platform roles may request. Support meets the incident first; see model/roles.ts. */
  canRequest: boolean
  /** Clinics for the picker. `null` means the register could not be read — see above. */
  clinics: readonly Tenant[] | null
  /** False when the register has more clinics than one page of the picker holds. */
  clinicsComplete: boolean
  /** The platform-wide live count from health, or `null` when health could not be read. */
  activeGrants: number | null
  /** `?cursor=` — opaque, straight from `meta.next_cursor`. */
  cursor?: string | undefined
  /** `?requested=` — the id of a grant just issued. */
  requested?: string | undefined
  /** `?problem=` and `?message=` — what the last request did, in the API's own words. */
  problem?: string | undefined
  message?: string | undefined
}

export async function BreakGlassScreen({
  paths,
  canRequest,
  clinics,
  clinicsComplete,
  activeGrants,
  cursor,
  requested,
  problem,
  message,
}: BreakGlassScreenProps) {
  const [live, register] = await Promise.all([
    attempt(listGrants({ active: true, per_page: 100 })),
    attempt(listGrants({ ...(cursor === undefined || cursor === '' ? {} : { cursor }) })),
  ])

  const liveGrants = live.ok ? live.value.data : []

  // Names for the ids on each card, where the register could supply them. A grant whose
  // clinic is not on the loaded page still renders, with its raw tenant id — an operator
  // during an incident needs to see that the grant exists far more than they need its name.
  const nameById = new Map((clinics ?? []).map((clinic) => [clinic.id, clinic.trading_name ?? clinic.legal_name]))

  async function request(formData: FormData) {
    'use server'

    const tenantId = String(formData.get('tenant_id') ?? '').trim()
    const scope = String(formData.get('scope') ?? '')
    const reason = String(formData.get('reason') ?? '').trim()
    const until = expiresAt(String(formData.get('window') ?? ''))

    /*
     * Shape only. Whether the reason is long enough to be reviewable is the API's rule and
     * is deliberately not restated here — the contract calls the minimum "a blunt instrument
     * ... here on purpose" and publishes no number, so a guess in this file would refuse
     * legitimate emergency requests for a reason this screen invented.
     *
     * `until` is null when the posted window is not one this build offers, which is the only
     * way a request could carry an expiry nobody chose.
     */
    if (tenantId === '' || reason === '' || !isScope(scope) || until === null) {
      return redirect(`${paths.register}?problem=incomplete`)
    }

    const outcome = await requestGrant({
      tenant_id: tenantId,
      reason,
      scope,
      expires_at: until,
    })

    if (outcome.kind === 'problem') {
      const search = new URLSearchParams({ problem: outcome.problem })

      if (outcome.message) {
        search.set('message', outcome.message)
      }

      return redirect(`${paths.register}?${search.toString()}`)
    }

    return redirect(`${paths.register}?requested=${encodeURIComponent(outcome.grant.id)}`)
  }

  const count = activeGrants ?? liveGrants.length

  return (
    <>
      <PageHeader
        title="Break-glass"
        description={
          'Time-boxed emergency access to a clinic’s data — requested with a reason and a '
          + 'scope, notified to the clinic, and never quiet.'
        }
      />

      <Stack gap="6">
        <Inline gap="3">
          <a className="lnk" href={paths.overview}>
            Platform overview
          </a>
        </Inline>

        {/* ---- The count, framed. See the note at the top of this file. ---- */}
        <Card as="section" aria-label="Break-glass grants live now">
          <Grid cols={2} gap="6">
            {/*
              A `Stat`, which decides the size from the type scale rather than from a number
              typed here. It was `fontSize: 44` by hand, and so was the identical figure on
              the overview screen — two hand-set sizes in two files for one number, either of
              which could have been edited alone. The label precedes the value by
              construction: "3" announced on its own is a dead end, and this is the figure
              whose meaning is the least obvious in the whole app.
            */}
            <Stat
              label="Grants live now"
              value={count}
              note={
                activeGrants === null
                  ? 'counted from the grants on this page — the platform figure could not be read'
                  : undefined
              }
            />
            <p className="muted">
                This is a measure of the SUPPORT TOOLING, not of access control. A rising
                count means ordinary metadata-based diagnosis is inadequate, and the correct
                response is to build better diagnosis — not to conclude that break-glass is
                working well. Grants are reviewed periodically, by someone who was not in the
              room.
            </p>
          </Grid>
        </Card>

        <Notice tone="warn" icon="shield" title="Everything here is recorded and the clinic is told">
          Every request, grant and access is written to the platform audit log AND surfaced to
          the affected clinic. The clinic is the data controller and Carevelo is its
          processor: it has a right to know when we read its records, and that notification is
          issued in the same transaction as the grant — it is not a setting anyone can turn
          off. Ordinary support tooling exposes no clinical data; diagnosis works from
          identifiers, states and audit trails, and this is what you use when it cannot.
        </Notice>

        <Outcome problem={problem} message={message} requested={requested} />

        {/* ---- What is open right now ---- */}
        <Stack as="section" gap="5" aria-labelledby="bg-live">
          <h2 id="bg-live">Open right now</h2>

          {!live.ok ? (
            <Notice tone="bad" icon="activity" title="The live grants could not be read">
              {live.message
                ?? 'The request to /v1/platform/break-glass did not complete. Nothing follows '
                  + 'from that about whether grants are open — only that this screen could '
                  + 'not ask.'}
            </Notice>
          ) : liveGrants.length === 0 ? (
            <EmptyState icon="check" title="No grant is open">
              Nothing is currently permitting a Carevelo operator into a clinic&rsquo;s
              records. This is the state to be in.
            </EmptyState>
          ) : (
            <Stack gap="4">
              {liveGrants.map((grant) => (
                <GrantCard key={grant.id} grant={grant} clinic={nameById.get(grant.tenant_id)} />
              ))}
            </Stack>
          )}

          {/*
            Where a revoke button would be. Saying what the product does instead is more
            useful than saying nothing, because an operator who cannot find the control will
            otherwise assume it is elsewhere and go looking.
          */}
          <Notice tone="info" icon="clock" title="There is no way to end a grant early">
            Grants expire; they are not revoked. The published API has no revoke endpoint and
            this screen builds no control that pretends otherwise — the time box IS the
            control, which is why the shortest window is the default and why asking again is
            cheap. What this screen offers instead is the whole of what is open, its scope,
            its stated reason and the instant it lapses.
          </Notice>
        </Stack>

        {/* ---- Asking for one ---- */}
        {canRequest ? (
          <Card as="section" aria-labelledby="bg-request">
            <form action={request}>
              <Stack gap="7">
              <Stack gap="2">
                <h2 id="bg-request">Request a grant</h2>
                <p className="muted">
                  A named operator, a named clinic, a stated reason and an expiry. Approval by
                  a second platform administrator applies where staffing allows; where it does
                  not, the grant is self-approved and flagged for later review — which is a
                  weaker control and is named as one rather than dressed up.
                </p>
              </Stack>

              {clinics === null ? (
                <>
                  <Notice tone="warn" icon="help" title="The clinic list could not be loaded">
                    The register did not answer, so this form is asking for the identifier
                    directly rather than disappearing. A break-glass screen that cannot be
                    used because a list failed is a break-glass screen that is not there when
                    it is needed. Check the identifier: a wrong one notifies an innocent
                    clinic.
                  </Notice>

                  <Field
                    name="tenant_id"
                    label="Clinic identifier"
                    hint="The tenant id, exactly. The clinic named here is the clinic notified."
                  >
                    {(control) => (
                      <Input {...control} type="text" required autoComplete="off" spellCheck={false} />
                    )}
                  </Field>
                </>
              ) : (
                <Field
                  name="tenant_id"
                  label="Clinic"
                  hint={
                    clinicsComplete
                      ? 'The clinic named here is the clinic notified.'
                      : 'The clinic named here is the clinic notified. NOTE: only the first '
                        + 'page of the register is listed — the endpoint offers no search — so '
                        + 'a clinic missing from this list is not necessarily missing from '
                        + 'Carevelo.'
                  }
                >
                  {(control) => (
                    <Select {...control} required defaultValue="">
                      <option value="" disabled>
                        Choose a clinic
                      </option>
                      {clinics.map((clinic) => (
                        <option key={clinic.id} value={clinic.id}>
                          {clinic.trading_name ?? clinic.legal_name} ({clinic.subdomain})
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              )}

              <Choice
                name="scope"
                legend="Which records"
                hint={
                  'From a closed list, and nothing is pre-selected. Choose the narrowest scope '
                  + 'that answers the question — this is the field a reviewer sorts by when '
                  + 'nobody remembers the incident.'
                }
                options={SCOPES.map((scope) => ({
                  value: scope.value,
                  label: scope.label,
                  note: scope.note,
                }))}
                required
              />

              <Field
                name="reason"
                label="Why"
                hint={
                  'In enough words to be reviewable by somebody who was not in the room. '
                  + '“debug” satisfies a required rule and tells a later reviewer nothing. '
                  + 'The API enforces a minimum length; this form does not restate the number, '
                  + 'because a guess here would refuse legitimate requests during an incident.'
                }
                /*
                  THE REFUSAL IS ATTACHED TO THE FIELD IT IS ABOUT, not only announced above
                  the form. `?problem=invalid` on this form is, in practice, always the
                  reason: it is the only field the API applies a content rule to, and that
                  rule is a minimum length this screen deliberately does not restate. The
                  message travels as the API's own sentence. Without `error` the control
                  itself claimed to be fine — no `aria-invalid`, no `aria-describedby` — so a
                  screen-reader user arriving at the textarea after the redirect was told
                  nothing was wrong with the one thing that was.
                */
                {...(problem === 'invalid' ? { error: message ?? 'The API refused this reason.' } : {})}
              >
                {(control) => <Textarea {...control} required rows={4} />}
              </Field>

              <Field
                name="window"
                label="For how long"
                hint={
                  'The time box, computed from this server’s clock so a grant cannot start in '
                  + 'the past. The shortest window is the default: if you still need access at '
                  + 'the end of it, ask again — that second request is another audit entry, '
                  + 'and that is the point.'
                }
              >
                {(control) => (
                  <Select {...control} defaultValue={WINDOWS[0]?.value}>
                    {WINDOWS.map((window) => (
                      <option key={window.value} value={window.value}>
                        {window.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Notice tone="warn" icon="lock" title="What pressing this does">
                It issues the grant and notifies the clinic in the same transaction, writes the
                request to the platform audit log, and starts the clock. Every access made
                under it writes a further audit event in the clinic&rsquo;s own trail. None of
                that can be undone from here, and the grant cannot be ended early.
              </Notice>

              <Inline gap="4">
                <Button type="submit" variant="primary" size="lg">
                  Request this grant
                </Button>
              </Inline>
              </Stack>
            </form>
          </Card>
        ) : (
          <Notice tone="info" icon="lock" title="This account cannot request a grant">
            Requesting break-glass needs <code>platform_support</code> or{' '}
            <code>platform_admin</code>.
          </Notice>
        )}

        {/* ---- The register ---- */}
        <Stack as="section" gap="5" aria-labelledby="bg-register">
          <h2 id="bg-register">The register</h2>
          <p className="muted">
            Kept permanently, and worth reading as a metric rather than as a log: the count
            over time says whether the ordinary support tooling is adequate, which is more
            useful than any single entry. Paged by cursor, so entries are not duplicated or
            skipped while grants are being issued beside it.
          </p>

          {!register.ok ? (
            <Notice tone="bad" icon="activity" title="The register could not be read">
              {register.message ?? 'The request did not complete.'}
            </Notice>
          ) : register.value.data.length === 0 ? (
            <EmptyState icon="file" title="No grants recorded">
              Nothing has ever been granted, or this page of the register is empty.
            </EmptyState>
          ) : (
            <>
              <Stack gap="4">
                {register.value.data.map((grant) => (
                  <GrantCard key={grant.id} grant={grant} clinic={nameById.get(grant.tenant_id)} />
                ))}
              </Stack>

              {/*
                `Pagination` rather than two hand-built buttons, and the property that
                matters is what it CANNOT do: it has no `page` prop and nothing that would
                accept an offset. Grants are issued while somebody reads this register, which
                is exactly the traffic under which an offset duplicates and skips rows — and
                a skipped row in an audit register is a grant nobody reviewed.
              */}
              <Pagination
                label="Break-glass register pages"
                summary={`${register.value.data.length} grants on this page`}
                {...(register.value.meta.prev_cursor
                  ? {
                      previousHref: `${paths.register}?cursor=${encodeURIComponent(register.value.meta.prev_cursor)}`,
                    }
                  : {})}
                {...(register.value.meta.next_cursor
                  ? {
                      nextHref: `${paths.register}?cursor=${encodeURIComponent(register.value.meta.next_cursor)}`,
                    }
                  : {})}
              />
            </>
          )}
        </Stack>
      </Stack>
    </>
  )
}

/**
 * What the last request had to say about itself.
 *
 * THE SUCCESS BANNER DELIBERATELY DOES NOT CLAIM THE CLINIC WAS NOTIFIED. The API issues the
 * grant and the notification together, but this screen only knows what the register tells it
 * — so the banner points at the grant that was just created and lets its card carry the
 * notification state. A confirmation that asserted "the clinic has been told" would be
 * repeating the happy path back at the operator rather than reporting it.
 */
function Outcome({
  problem,
  message,
  requested,
}: {
  problem?: string | undefined
  message?: string | undefined
  requested?: string | undefined
}) {
  if (requested) {
    return (
      <Notice tone="info" icon="check" title="Grant requested">
        Grant <code>{requested}</code> was created and the clock has started. Its card below
        shows the scope, the expiry and whether the clinic&rsquo;s notification has been
        recorded — check that last one: an unnotified grant permits nothing.
      </Notice>
    )
  }

  if (problem === undefined || problem === '') {
    return null
  }

  if (problem === 'incomplete') {
    return (
      <Notice tone="warn" title="Nothing was requested">
        A grant needs a clinic, a scope, a reason and a window. Nothing was submitted and no
        clinic was notified.
      </Notice>
    )
  }

  if (problem === 'not_found') {
    return (
      <Notice tone="warn" icon="help" title="That clinic is not there">
        No grant was created and nobody was notified. Check the identifier against the tenant
        register.
      </Notice>
    )
  }

  if (problem === 'refused') {
    return (
      <Notice tone="warn" icon="lock" title="Refused">
        {message ?? 'The API refused this request for this account.'}
      </Notice>
    )
  }

  if (problem === 'invalid') {
    return (
      <Notice tone="warn" title="The API refused these details">
        {message
          ?? 'Check the reason and the window. The reason has a minimum length, which is '
            + 'enforced on the API and deliberately not restated on this form.'}
      </Notice>
    )
  }

  return (
    <Notice tone="bad" title="No grant was created">
      {message
        ?? 'The request did not complete, and the API gave no reason this screen can pass on. '
          + 'Nothing was granted and no clinic was notified.'}
    </Notice>
  )
}
