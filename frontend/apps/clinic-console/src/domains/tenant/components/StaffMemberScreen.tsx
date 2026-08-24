import { notFound, redirect } from 'next/navigation'
import { Badge, Button, Card, Choice, Field, Input, Notice, Select, Stack } from '@carevelo/ui'
import { attempt, writeFailure } from '../api/http'
import { createClinicianProfile, getClinicianProfile, updateClinicianProfile } from '../api/clinicians'
import { countActiveAdministrators, findStaff, updateStaff } from '../api/staff'
import type { ClinicianProfile, RegistrationBody, Staff, StaffRole, TenantPaths } from '../model/types'
import { AccessNotice } from './AccessNotice'
import {
  REGISTRATION_BODY_LABELS,
  REGISTRATION_NOT_VERIFIED,
  ROLE_LABELS,
  ROLE_ORDER,
  checked,
  first,
  samePath,
  staffMemberPath,
  text,
  trimmed,
  withParams,
  type SearchValue,
} from './screen'

/**
 * One colleague: their details, their role, their access, and — if they are a clinician —
 * the registration details that make them bookable.
 *
 * ------------------------------------------------------------------------------
 * THE CLINICIAN PROFILE IS THE PIECE EVERYONE FORGETS, AND IT IS THE ONE THAT MATTERS.
 *
 * An invitation produces a User in a role. A CLINICIAN ROW is a different thing: the
 * registration body, the registration number and the prescribing capability. Availability
 * is generated per clinician row, so until one exists this colleague offers no appointment
 * times — and the clinic's booking page is empty for a reason nobody would look for on a
 * staff screen. The onboarding checklist's "at least one registered clinician" gate is
 * required for activation and this form is the only thing that satisfies it.
 *
 * ------------------------------------------------------------------------------
 * PRESCRIBING CANNOT OUTRUN THE NUMBER BEHIND IT, AND THE FORM SAYS SO BEFORE IT REFUSES.
 *
 * `can_prescribe = true` with a blank registration number is refused with a 409. The PRD's
 * exception path is why both halves exist: a clinician whose registration number is not to
 * hand is SAVED with prescribing off and prompted to complete it later, because a clinic
 * that cannot record a colleague at all until somebody finds a certificate does not finish
 * onboarding today. So the number may be left empty, the tickbox says what it depends on,
 * and the refusal — when it comes — names the way through.
 *
 * ------------------------------------------------------------------------------
 * RECORDED, NEVER VERIFIED.
 *
 * Carevelo has no access to the UMDPC, AHPC or Nurses & Midwives registers and performs no
 * lookup against any of them. The statement sits above the fields, for the same reason it
 * does on the compliance screen: somebody typing a practitioner number into a health
 * platform reasonably assumes it is being checked, and the correction has to arrive before
 * the assumption does.
 *
 * ------------------------------------------------------------------------------
 * THE LAST ADMINISTRATOR KEEPS THEIR ACCESS.
 *
 * When this colleague is the clinic's only active administrator, the controls that would
 * remove that access are not rendered. The rule itself stays in `StaffController`, which
 * refuses with a 409 either way; what this avoids is offering a button whose only possible
 * outcome is a refusal, at the moment somebody believes they have just removed their own
 * way back in.
 */

export type StaffMemberScreenProps = {
  paths: TenantPaths
  /** Straight out of the route's `[user]` segment. Resolved below, never trusted. */
  userId: string
  saved?: SearchValue
  problem?: SearchValue
}

/**
 * WHY THE 404 IS RAISED HERE AND NOT IN THE ROUTE.
 *
 * The route would have to hold the decision, and the decision is not one decision. Fetching
 * this colleague can end three ways — the session expired, the caller is not an
 * administrator, or there is nobody with this id — and only the last is a 404. A route that
 * collapsed the first two into `notFound()` would tell a clinician who wandered in that
 * their colleague does not exist; one that let them throw would replace the explanation
 * with the framework's error boundary. Both belong to the screen that already renders those
 * explanations everywhere else in this domain.
 *
 * The 404 itself is the same page for an id that never existed, an id belonging to another
 * clinic's staff member, and an id belonging to a patient account. That indistinguishability
 * is the isolation boundary: a 403 would confirm the account exists, which discloses that a
 * named person works at some other clinic on Carevelo.
 */
export async function StaffMemberScreen(props: StaffMemberScreenProps) {
  const { paths } = props
  const saved = first(props.saved)
  const problem = first(props.problem)

  const found = await attempt(findStaff(props.userId))

  if (!found.ok) {
    return <AccessNotice failure={found} context="this colleague" />
  }

  if (found.value === null) {
    notFound()
  }

  const person: Staff = found.value
  const isClinician = person.roles.includes('clinician')

  const [profileResult, administrators] = await Promise.all([
    isClinician ? attempt(getClinicianProfile(person.id)) : null,
    attempt(countActiveAdministrators()),
  ])

  const isLastAdministrator =
    person.is_active
    && person.roles.includes('clinic_admin')
    && administrators.ok
    && administrators.value <= 1

  const selfPath = staffMemberPath(paths.staffMember, person.id)

  return (
    <div className="grid">
      {problem === undefined ? null : (
        <Notice tone="bad" title="That was not saved" announce>
          {problem}
        </Notice>
      )}

      {saved === undefined ? null : <Notice tone="info">{saved}</Notice>}

      <Card as="section">
        {/*
          One Stack for the card, and the `marginTop` the form was carrying is now its gap.
          The heading row, the notice and the form were three blocks in normal flow with the
          space between them set on one of the three — which is how the notice ended up flush
          against the heading while the form below it stood 18px clear. The same rhythm for
          every child of the card is one decision instead of three, and it is the shape
          PaymentConnectionScreen already uses.
        */}
        <Stack gap="6">
          <div className="row between">
            <div className="grow">
              <span className="eyebrow">Colleague</span>
              <h2 className="title-sm">{person.name}</h2>
            </div>
            {person.is_active ? (
              <Badge tone="good">Has access</Badge>
            ) : (
              <Badge tone="neutral">No access</Badge>
            )}
          </div>

          {person.phone_verified_at === null ? (
            <Notice tone="warn" title="They have not accepted their invitation yet">
              Until they follow the SMS link and set a password they cannot sign in. If the
              message never arrived, correct the number below and send a fresh invitation from
              the staff list — a new invitation replaces the old one.
            </Notice>
          ) : null}

          <form action={saveDetails.bind(null, { selfPath, id: person.id })}>
            <Stack gap="6">
              <Field name="name" label="Name">
                {(control) => (
                  <Input {...control} type="text" maxLength={200} defaultValue={person.name} required />
                )}
              </Field>

              <Field
                name="phone"
                label="Phone number"
                hint="How they sign in, and where Carevelo's notifications reach them."
              >
                {(control) => (
                  <Input
                    {...control}
                    type="tel"
                    inputMode="tel"
                    autoComplete="off"
                    defaultValue={person.phone ?? ''}
                  />
                )}
              </Field>

              <Field name="email" label="Email address" hint="Optional. Many clinic staff have none.">
                {(control) => (
                  <Input {...control} type="email" maxLength={255} defaultValue={person.email ?? ''} />
                )}
              </Field>

              {/*
               * PASSWORDS ARE ABSENT AND CANNOT BE ADDED. `UpdateStaffRequest` declares the
               * field `prohibited` with the reason on it: a person sets their own, and an
               * administrator who could write another user's password could read every clinical
               * record that user can reach — which defeats the role boundary entirely.
               */}
              <p className="fine">
                There is no way to set a colleague&rsquo;s password from here, by design. If they
                are locked out they set a new one themselves.
              </p>

              <div>
                <Button type="submit" variant="primary">
                  Save details
                </Button>
              </div>
            </Stack>
          </form>
        </Stack>
      </Card>

      <Card as="section">
        {/*
          One Stack for the card, and the `marginTop` the form was carrying is now its gap.
          The heading row, the notice and the form were three blocks in normal flow with the
          space between them set on one of the three — which is how the notice ended up flush
          against the heading while the form below it stood 18px clear. The same rhythm for
          every child of the card is one decision instead of three, and it is the shape
          PaymentConnectionScreen already uses.
        */}
        <Stack gap="6">
          <Stack gap="none">
            <span className="eyebrow">Access</span>
            <h2 className="title-sm">Role and sign-in</h2>
          </Stack>

          {isLastAdministrator ? (
            <Notice tone="info" title="This is the clinic's last administrator" icon="lock">
              <p>
                Their role and their access are locked while they are the only active
                administrator here. Invite or promote another administrator first, and these
                controls come back.
              </p>
              <p className="fine">
                This clinic is the data controller for every patient record inside it. An
                administrator who locks themselves out cannot answer a subject-access request
                or a regulator, and undoing it needs Carevelo support with database access.
              </p>
            </Notice>
          ) : (
            <form action={saveAccess.bind(null, { selfPath, id: person.id })}>
              <Stack gap="6">
                <Choice
                  name="role"
                  id={`role-${person.id}`}
                  legend="Role"
                  hint="Exactly one. Changing it takes effect the next time they load a page."
                  options={ROLE_ORDER.map((role) => ({ value: role, label: ROLE_LABELS[role] }))}
                  defaultValue={currentRole(person)}
                />

                <label className="row" htmlFor={`active-${person.id}`}>
                  <input
                    className="choice__input"
                    type="checkbox"
                    id={`active-${person.id}`}
                    name="is_active"
                    defaultChecked={person.is_active}
                  />
                  <span className="choice__text">
                    <span>They can sign in</span>
                    <span className="choice__note">
                      Clearing this ends their access. Nothing they have already recorded is
                      removed — a clinician who leaves keeps their name on the notes they wrote.
                    </span>
                  </span>
                </label>

                <div>
                  <Button type="submit" variant="primary">
                    Save access
                  </Button>
                </div>
              </Stack>
            </form>
          )}
        </Stack>
      </Card>

      {!isClinician ? (
        <Card as="section">
          <span className="eyebrow">Registration</span>
          <h2 className="title-sm">Not a clinical role</h2>
          <p className="muted">
            Registration details belong to a colleague in the clinician role. Change the role
            first if that is what they do — registration details on a pharmacist or a
            receptionist would put them in this clinic&rsquo;s availability, where patients
            would book them.
          </p>
        </Card>
      ) : profileResult !== null && !profileResult.ok ? (
        <Card as="section">
          <AccessNotice failure={profileResult} context="this colleague's registration details" />
        </Card>
      ) : (
        <ClinicianProfileCard
          selfPath={selfPath}
          userId={person.id}
          profile={profileResult !== null && profileResult.ok ? profileResult.value : null}
        />
      )}
    </div>
  )
}

/**
 * The registration details, whether or not they exist yet.
 *
 * ONE COMPONENT FOR BOTH CASES, because the fields are the same and the difference is one
 * verb. Two components would be two copies of the same six fields and the same attestation
 * notice, and the copies would drift on the field that matters least until the day it is
 * the field that matters most.
 */
function ClinicianProfileCard({
  selfPath,
  userId,
  profile,
}: {
  selfPath: string
  userId: string
  profile: ClinicianProfile | null
}) {
  const exists = profile !== null

  return (
    <Card as="section">
      {/*
        One Stack for the card, and the `marginTop` the form was carrying is now its gap.
        The heading row, the notice and the form were three blocks in normal flow with the
        space between them set on one of the three — which is how the notice ended up flush
        against the heading while the form below it stood 18px clear. The same rhythm for
        every child of the card is one decision instead of three, and it is the shape
        PaymentConnectionScreen already uses.
      */}
      <Stack gap="6">
        <div className="row between">
          <div className="grow">
            <span className="eyebrow">Registration</span>
            <h2 className="title-sm">
              {exists ? 'Registration details' : 'Not yet registered as a clinician'}
            </h2>
          </div>
          {profile?.may_prescribe ? (
            <Badge tone="good">May prescribe</Badge>
          ) : (
            <Badge tone="warn">Cannot prescribe</Badge>
          )}
        </div>

        {exists ? null : (
          <Notice tone="warn" title="This colleague offers no appointment times yet" icon="calendar">
            Appointment times are generated per registered clinician. Until these details are
            recorded, patients see nothing bookable with them however the opening hours and the
            catalogue are set up.
          </Notice>
        )}

        {profile?.has_expired_licence ? (
          <Notice tone="warn" title="The practising licence on file has expired">
            <p>
              Carevelo records this and does not block anything on it — licence currency is the
              clinic&rsquo;s regulatory responsibility, and blocking care on our possibly-stale
              copy of a register we cannot read would be the worse error. The expiry has been
              written to this clinic&rsquo;s audit trail, so the clinic can show it was told.
            </p>
          </Notice>
        ) : null}

        <Notice tone="info" title="Recorded, not verified" icon="shield">
          {REGISTRATION_NOT_VERIFIED}
        </Notice>

        <form action={saveProfile.bind(null, { selfPath, id: userId, exists })}>
          <Stack gap="6">
            <Field name="registration_body" label="Register">
              {(control) => (
                <Select {...control} defaultValue={profile?.registration_body ?? 'umdpc'} required>
                  {(Object.keys(REGISTRATION_BODY_LABELS) as RegistrationBody[]).map((body) => (
                    <option key={body} value={body}>
                      {REGISTRATION_BODY_LABELS[body]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field
              name="registration_number"
              label="Registration number"
              hint="May be left empty. A clinician saved without one is bookable but cannot prescribe until it is recorded."
            >
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  maxLength={100}
                  spellCheck={false}
                  defaultValue={profile?.registration_number ?? ''}
                />
              )}
            </Field>

            <Field name="specialty" label="Specialty" hint="Optional. Patients see this when choosing.">
              {(control) => (
                <Input {...control} type="text" maxLength={200} defaultValue={profile?.specialty ?? ''} />
              )}
            </Field>

            <Field
              name="practising_licence_expires_at"
              label="Practising licence expires"
              hint="Optional. An expired licence is flagged prominently and never blocks care."
            >
              {(control) => (
                <Input
                  {...control}
                  type="date"
                  defaultValue={toDateInput(profile?.practising_licence_expires_at)}
                />
              )}
            </Field>

            <label className="row" htmlFor={`prescribe-${userId}`}>
              <input
                className="choice__input"
                type="checkbox"
                id={`prescribe-${userId}`}
                name="can_prescribe"
                defaultChecked={profile?.can_prescribe ?? false}
              />
              <span className="choice__text">
                <span>They may issue prescriptions</span>
                <span className="choice__note">
                  Only possible with a registration number recorded above. Save with this off if
                  the number is not to hand, and turn it on when it is.
                </span>
              </span>
            </label>

            <div>
              <Button type="submit" variant="primary">
                {exists ? 'Save registration details' : 'Record these details'}
              </Button>
            </div>
          </Stack>
        </form>
      </Stack>
    </Card>
  )
}

/**
 * The one role a person holds, for the radio group's default.
 *
 * The backend syncs rather than adds, so there is exactly one in practice. A colleague
 * holding something this console does not recognise gets no preselection rather than a
 * wrong one — a radio group that quietly preselects "Administrator" because it could not
 * read the stored value would grant administrator access on the next save.
 */
function currentRole(person: Staff): string | undefined {
  return person.roles.find((role): role is StaffRole => role in ROLE_LABELS)
}

/**
 * An ISO instant as `YYYY-MM-DD`, for a date input.
 *
 * A date input silently blanks itself on a value it cannot parse, which reads to the
 * administrator as "no licence expiry recorded" and is one save away from becoming true.
 */
function toDateInput(value: string | null | undefined): string {
  return typeof value === 'string' ? value.slice(0, 10) : ''
}

type MemberContext = { selfPath: string; id: string }

async function saveDetails(context: MemberContext, formData: FormData): Promise<void> {
  'use server'

  const back = samePath(context.selfPath, '/')
  let failure: string | null = null

  try {
    /*
     * `name` and `phone` are `sometimes|string` and NOT nullable on the backend, so an
     * empty box would be a validation failure rather than a clearing. They are sent only
     * when they have something in them; `email` IS nullable, so an emptied box clears it.
     */
    const name = trimmed(formData, 'name')
    const phone = trimmed(formData, 'phone')

    await updateStaff(context.id, {
      ...(name === null ? {} : { name }),
      ...(phone === null ? {} : { phone }),
      email: trimmed(formData, 'email'),
    })
  } catch (error) {
    failure = writeFailure(error, 'saving a colleague')
  }

  if (failure !== null) {
    redirect(withParams(back, { problem: failure, saved: null }))
  }

  redirect(withParams(back, { saved: 'Saved.', problem: null }))
}

/**
 * Role and access.
 *
 * A 409 from here is the last-administrator refusal, and its sentence names the remedy. The
 * screen does not render these controls for the last administrator at all, so reaching this
 * refusal means the count moved between the render and the submit — two administrators, one
 * of whom was deactivated in another tab. That is exactly the race the backend rule exists
 * for, and the message passes through unchanged.
 */
async function saveAccess(context: MemberContext, formData: FormData): Promise<void> {
  'use server'

  const back = samePath(context.selfPath, '/')
  const role = text(formData, 'role') ?? ''
  let failure: string | null = null

  try {
    await updateStaff(context.id, {
      ...((ROLE_ORDER as readonly string[]).includes(role) ? { role: role as StaffRole } : {}),
      is_active: checked(formData, 'is_active'),
    })
  } catch (error) {
    failure = writeFailure(error, 'changing a colleague\'s access')
  }

  if (failure !== null) {
    redirect(withParams(back, { problem: failure, saved: null }))
  }

  redirect(withParams(back, { saved: 'Access saved.', problem: null }))
}

/**
 * Record or correct the registration details.
 *
 * `registration_number` IS ALWAYS SENT, including when it is empty, and that is the
 * difference between a decision and an accident. `StoreClinicianRequest` validates it
 * `present|nullable` precisely so an empty value has to be stated: leaving the key out of
 * the payload is how a client discovers weeks later that a number it thought it sent was
 * never stored.
 *
 * `can_prescribe` likewise goes on every submission rather than only when ticked, because
 * an unticked checkbox is absent from a form post — and on a PATCH an absent key means
 * "leave it alone", which would make it impossible to ever switch prescribing OFF from this
 * screen.
 */
async function saveProfile(
  context: MemberContext & { exists: boolean },
  formData: FormData,
): Promise<void> {
  'use server'

  const back = samePath(context.selfPath, '/')
  const body = text(formData, 'registration_body') ?? 'umdpc'

  const fields = {
    registration_body: body as RegistrationBody,
    registration_number: trimmed(formData, 'registration_number'),
    specialty: trimmed(formData, 'specialty'),
    practising_licence_expires_at: trimmed(formData, 'practising_licence_expires_at'),
    can_prescribe: checked(formData, 'can_prescribe'),
  }

  let failure: string | null = null

  try {
    if (context.exists) {
      await updateClinicianProfile(context.id, fields)
    } else {
      await createClinicianProfile(context.id, fields)
    }
  } catch (error) {
    failure = writeFailure(error, 'saving registration details')
  }

  if (failure !== null) {
    redirect(withParams(back, { problem: failure, saved: null }))
  }

  redirect(
    withParams(back, {
      saved:
        'Registration details recorded as this clinic\'s own attestation. This colleague now '
        + 'appears in the clinic\'s availability.',
      problem: null,
    }),
  )
}
