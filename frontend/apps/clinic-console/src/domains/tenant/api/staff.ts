import { readClient, writeClient } from './http'
import type { Invitation, Staff, StaffChanges, StaffPage } from '../model/types'

/**
 * Who works at this clinic, in which role, and with access.
 *
 * ------------------------------------------------------------------------------
 * TWO RULES THE SCREEN INHERITS RATHER THAN INVENTS.
 *
 * 1. THE LAST ACTIVE ADMINISTRATOR CANNOT LOSE ADMINISTRATIVE ACCESS. `StaffController`
 *    refuses it with a 409 and a sentence naming the remedy. The screen ALSO declines to
 *    offer the control — see `components/StaffMemberScreen.tsx` — and that is belt and
 *    braces rather than duplication of the rule: the refusal stays the backend's, and the
 *    screen's job is not to invite an administrator to lock their own clinic out and then
 *    tell them off for trying. Locking a clinic out of its own tenant is a support
 *    incident that needs database access to undo, and it is worse than inconvenient: the
 *    clinic is the data controller for every record inside, and a controller that cannot
 *    reach its own data cannot answer a subject-access request or a regulator.
 *
 * 2. THE INVITATION TOKEN IS NEVER RETURNED. The 201 carries an id, a role, an expiry and
 *    a note; the token itself exists in the SMS and nowhere else — not this response, not
 *    the audit event, not a log line. So there is nothing for this screen to display, copy
 *    or re-send, and a "copy invitation link" control could not be built here even if
 *    somebody asked for one.
 */

/**
 * One page of colleagues.
 *
 * CURSOR-PAGINATED, never offset. The cursor is opaque and comes from `meta.next_cursor`;
 * the screen passes it straight back and never constructs one.
 *
 * The list excludes patient accounts, which matters more than it sounds: a clinic has tens
 * of staff and thousands of patients, and without that filter the staff list is a patient
 * list twenty-five at a time. It is also a data-minimisation point — the staff surface is
 * administrative, and a patient's presence on it is not administration.
 */
export async function listStaff(cursor?: string | undefined): Promise<StaffPage> {
  const client = await readClient()

  return client.get<StaffPage>('/v1/tenant/users', {
    query: cursor === undefined ? {} : { cursor },
  })
}

/**
 * Invite a colleague by phone.
 *
 * BY PHONE, because that is the credential this market actually has: most Ugandan clinic
 * staff have a working handset and no reliably checked email address. The role is fixed
 * here by the administrator and the person accepting cannot change it — self-elevation on
 * acceptance would make the whole RBAC matrix advisory.
 *
 * Re-inviting the same number REPLACES the outstanding invitation rather than stacking a
 * second one. Two live tokens for one person is two chances for the wrong one to be spent,
 * potentially into two different roles.
 */
export async function inviteStaff(invitation: Invitation): Promise<{ expires_at: string }> {
  const client = await writeClient()
  const response = await client.post<{ data: { expires_at: string } }>(
    '/v1/tenant/users/invite',
    invitation,
  )

  return response.data
}

/**
 * Correct a colleague's details, role or access.
 *
 * A 409 here is the last-administrator refusal and carries the sentence to show. A 404 is
 * a user who is not a colleague of this clinic — another tenant's staff member, or a
 * patient account — and it is 404 rather than 403 deliberately: a 403 would confirm the
 * account exists, which discloses that a named person works at some other clinic on
 * Carevelo.
 */
export async function updateStaff(id: string, changes: StaffChanges): Promise<Staff> {
  const client = await writeClient()
  const response = await client.patch<{ data: Staff }>(
    `/v1/tenant/users/${encodeURIComponent(id)}`,
    changes,
  )

  return response.data
}

/**
 * The colleague with this id, from the page they are on.
 *
 * THERE IS NO `GET /v1/tenant/users/{user}`, so a single colleague cannot be fetched by
 * id and this walks the cursor instead. It is bounded by the size of one clinic's payroll
 * — tens of people, a page of twenty-five at a time — and the walk stops at a hard limit
 * so a paginator that never terminates cannot hang a render.
 *
 * Returns `null` for a colleague who is not there, which the route turns into a 404. Not
 * a 403 and not an empty screen: the id came out of a URL, and an id that names nobody in
 * this clinic is indistinguishable from an id that names somebody in another one. That
 * indistinguishability IS the isolation boundary.
 */
export async function findStaff(id: string): Promise<Staff | null> {
  let cursor: string | undefined

  for (let page = 0; page < 40; page += 1) {
    const result = await listStaff(cursor)
    const match = result.data.find((person) => person.id === id)

    if (match) {
      return match
    }

    const next = result.meta.next_cursor

    if (!next) {
      return null
    }

    cursor = next
  }

  return null
}

/**
 * How many active administrators this clinic has.
 *
 * WHY THE SCREEN NEEDS THIS AT ALL, given that the backend already refuses to remove the
 * last one. Because the refusal arrives AFTER the administrator has pressed the button on
 * their own account, and the two are not equivalent: `StaffController` stops the clinic
 * being locked out, and this stops the console offering an action whose only outcome is a
 * refusal. Offering a control that cannot work and then explaining why is a worse screen
 * than not offering it, and on this particular control the explanation arrives at the
 * moment somebody believed they had just removed their own access.
 *
 * IT IS NOT A SECOND COPY OF THE RULE. The rule stays exactly where it is; nothing here
 * decides whether the change is legal, and if this count is stale — a colleague promoted in
 * another tab a second ago — the backend still gets the last word and the screen still
 * shows its sentence. This is a presentation decision informed by a count, and the count
 * is allowed to be a moment out of date.
 *
 * The walk is bounded by one clinic's payroll: tens of people, twenty-five to a page. The
 * page cap stops a paginator that never terminates from hanging a render.
 */
export async function countActiveAdministrators(): Promise<number> {
  let cursor: string | undefined
  let total = 0

  for (let page = 0; page < 40; page += 1) {
    const result = await listStaff(cursor)

    total += result.data.filter(
      (person) => person.is_active && person.roles.includes('clinic_admin'),
    ).length

    const next = result.meta.next_cursor

    if (!next) {
      return total
    }

    cursor = next
  }

  return total
}
