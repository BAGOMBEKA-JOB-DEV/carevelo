import { redirect } from 'next/navigation'
import { Badge, Button, Card, Choice, DataTable, EmptyState, Field, Input, Notice, Stack } from '@carevelo/ui'
import { attempt, writeFailure } from '../api/http'
import { inviteStaff, listStaff } from '../api/staff'
import type { Staff, StaffRole, TenantPaths } from '../model/types'
import { AccessNotice } from './AccessNotice'
import {
  ROLE_LABELS,
  ROLE_ORDER,
  first,
  samePath,
  staffMemberPath,
  text,
  trimmed,
  withParams,
  type SearchValue,
} from './screen'

/**
 * The clinic's own staff list, and the invitations that fill it.
 *
 * ------------------------------------------------------------------------------
 * INVITED BY PHONE, AND THE TOKEN IS NEVER SHOWN HERE.
 *
 * The colleague receives a single-use, expiring SMS link and CHOOSES THEIR OWN PASSWORD
 * when they accept it. Holding the token is what proves the number, so acceptance is what
 * marks the account phone-verified — and no colleague ever knows another's password.
 *
 * The 201 carries an id, a role, an expiry and a note. It does NOT carry the token, and
 * that is structural rather than an oversight: the invitation row holds a HASH, the
 * plaintext leaves the backend exactly once in the SMS, and a leaked database backup is
 * therefore not a set of usable invitations. So there is no "copy the link" control on this
 * screen and there cannot be one. If the SMS does not arrive, the answer is to correct the
 * number and invite again — which replaces the outstanding invitation rather than adding a
 * second live token for the same person.
 *
 * ------------------------------------------------------------------------------
 * A CLINICIAN IS NOT A CLINICIAN UNTIL THEY HAVE A PROFILE.
 *
 * An invitation produces an ACCOUNT in a role. Availability is generated per CLINICIAN ROW,
 * so a colleague invited as a clinician who has no registration details recorded offers no
 * appointment times at all — and the clinic's booking page stays empty for a reason nobody
 * would think to look for on the staff screen. The list therefore flags it, and the way to
 * fix it is one link away.
 */

export type StaffScreenProps = {
  paths: TenantPaths
  /** The opaque cursor from `meta.next_cursor`. Never constructed here. */
  cursor?: SearchValue
  saved?: SearchValue
  problem?: SearchValue
}

export async function StaffScreen(props: StaffScreenProps) {
  const { paths } = props
  const cursor = first(props.cursor)
  const saved = first(props.saved)
  const problem = first(props.problem)

  const result = await attempt(listStaff(cursor))

  if (!result.ok) {
    return <AccessNotice failure={result} context="the staff list" />
  }

  const page = result.value
  const next = page.meta.next_cursor

  return (
    <div className="grid">
      {problem === undefined ? null : (
        <Notice tone="bad" title="That did not work" announce>
          {problem}
        </Notice>
      )}

      {saved === undefined ? null : <Notice tone="info">{saved}</Notice>}

      <Card as="section">
        <span className="eyebrow">Colleagues</span>
        <h2 className="title-sm">Who works at this clinic</h2>

        {/*
         * The name is `rowHeader`, so DataTable renders it as the `<th scope="row">` this
         * table already had — and `.table tbody th` in console.css dresses it as the body
         * cell it sits among, which is what the hand-set `fontWeight: 600` was doing here.
         * No table in this app is now allowed to reach a `<th>` without a scope: the type
         * is the check, and nothing in the linter could ever have been.
         */}
        <DataTable
          caption="Everyone with an account at this clinic, by the order the API returns."
          captionHidden
          rows={page.data}
          rowKey={(person) => person.id}
          empty={
            <EmptyState icon="users" title="Nobody has been invited yet">
              You are the only account here. A clinic needs at least one clinician with
              registration details recorded before it can offer a single appointment time.
            </EmptyState>
          }
          columns={[
            {
              key: 'name',
              header: 'Name',
              rowHeader: true,
              cell: (person) => (
                <a className="lnk" href={staffMemberPath(paths.staffMember, person.id)}>
                  {person.name}
                </a>
              ),
            },
            { key: 'role', header: 'Role', cell: (person) => roleNames(person) },
            { key: 'phone', header: 'Phone', cell: (person) => person.phone ?? '—' },
            { key: 'status', header: 'Status', cell: (person) => <StaffStatus person={person} /> },
          ]}
        />

        {/*
         * CURSOR PAGINATION, and the link carries the API's own opaque cursor. There is no
         * page number here and there must not be one: an offset over a list that changes
         * while somebody reads it skips and repeats rows, which on a staff list means a
         * colleague who appears to have been removed.
         */}
        {next ? (
          <p>
            <a className="lnk" href={withParams(paths.staff, { cursor: next })}>
              More colleagues
            </a>
          </p>
        ) : null}
      </Card>

      <Card as="section">
        <Stack gap="6">
          <Stack gap="none">
            <span className="eyebrow">Invite</span>
            <h2 className="title-sm">Add a colleague</h2>
            <p className="muted">
              They receive a single-use SMS link and set their own password. The role you choose
              here is the role they get — they cannot change it when they accept, and nobody
              ever learns anybody else&rsquo;s password.
            </p>
          </Stack>

          <form action={sendInvitation.bind(null, { selfPath: paths.staff })}>
            <Stack gap="6">
              <Field name="name" label="Their name">
                {(control) => <Input {...control} type="text" maxLength={200} required />}
              </Field>

              <Field
                name="phone"
                label="Their phone number"
                hint="A Ugandan number. This is where the invitation goes, and it becomes how they sign in."
              >
                {(control) => (
                  <Input {...control} type="tel" inputMode="tel" autoComplete="off" required />
                )}
              </Field>

              <Choice
                name="role"
                id="invite-role"
                legend="Their role"
                hint="One role per person. Overlapping roles make the access rules unreadable and produce access nobody intended."
                required
                options={ROLE_ORDER.map((role) => ({
                  value: role,
                  label: ROLE_LABELS[role],
                  note: ROLE_NOTES[role],
                }))}
              />

              <div>
                <Button type="submit" variant="primary">
                  Send the invitation
                </Button>
              </div>

            </Stack>
          </form>
        </Stack>
</Card>
    </div>
  )
}

/**
 * What each role can actually do, in one line.
 *
 * Roles and not permissions: the RBAC matrix is the contract, and a console that explains
 * itself in terms of individual permissions drifts from it. These describe the JOB, which
 * is what the administrator is choosing between.
 */
const ROLE_NOTES: Record<StaffRole, string> = {
  clinician: 'Sees patients, writes notes, issues prescriptions. Needs registration details recorded.',
  front_desk: 'Registers patients, books on their behalf, takes payment at the counter.',
  pharmacist: 'Prices and fills dispense orders, proposes substitutions.',
  dispatcher: 'Assigns deliveries to riders and follows them.',
  rider: 'Sees only the next delivery: an address and a status to change. No clinical detail, ever.',
  clinic_admin: 'Everything above, plus these settings, staff and the clinic\'s payment connection.',
}

/**
 * Where a colleague is in the journey from invited to working.
 *
 * `phone_verified_at` is the signal an administrator actually needs while onboarding: an
 * invited colleague who never followed their link cannot sign in yet, and the clinic will
 * be waiting for somebody who does not know they are being waited for.
 */
function StaffStatus({ person }: { person: Staff }) {
  if (!person.is_active) {
    return <Badge tone="neutral">No access</Badge>
  }

  if (person.phone_verified_at === null) {
    return <Badge tone="warn">Invitation not accepted</Badge>
  }

  return <Badge tone="good">Active</Badge>
}

/**
 * The roles this colleague holds, in the administrator's words.
 *
 * `roles` is `string[]` on the resource and there is normally exactly one — the backend
 * syncs rather than adds. An unrecognised value is shown RAW rather than dropped, because
 * on a staff list a role nobody can name is the one thing an administrator most needs to
 * see; silently hiding it would hide access somebody has.
 */
function roleNames(person: Staff): string {
  if (person.roles.length === 0) {
    return 'No role'
  }

  return person.roles
    .map((role) => (role in ROLE_LABELS ? ROLE_LABELS[role as StaffRole] : role))
    .join(', ')
}

type InviteContext = { selfPath: string }

/**
 * Send the invitation.
 *
 * The role is checked against the offered list before it is sent. A form field is a value
 * from the far side of the wire, and while the API validates `role` against its own list
 * too, refusing it here keeps this screen from inviting somebody into a role it was never
 * asked to offer — which on this particular field means minting an administrator.
 */
async function sendInvitation(context: InviteContext, formData: FormData): Promise<void> {
  'use server'

  const back = samePath(context.selfPath, '/')
  const role = text(formData, 'role') ?? ''

  if (!(ROLE_ORDER as readonly string[]).includes(role)) {
    redirect(
      withParams(back, { problem: 'Choose one of this clinic\'s own roles.', saved: null }),
    )
  }

  let failure: string | null = null

  try {
    await inviteStaff({
      name: trimmed(formData, 'name') ?? '',
      phone: trimmed(formData, 'phone') ?? '',
      role: role as StaffRole,
    })
  } catch (error) {
    failure = writeFailure(error, 'sending an invitation')
  }

  if (failure !== null) {
    redirect(withParams(back, { problem: failure, saved: null }))
  }

  redirect(
    withParams(back, {
      saved:
        'Invitation sent by SMS. It is single-use and expires; if it does not arrive, correct the '
        + 'number and invite again — that replaces the old one rather than adding a second.',
      problem: null,
    }),
  )
}
