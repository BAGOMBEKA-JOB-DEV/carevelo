import { redirect } from 'next/navigation'
import { Card, Notice, Stack } from '@carevelo/ui'
import { cancelPrescription, documentLink, listPrescriptions, readPrescriber } from '../api/prescriptions'
import { prescribingBlock, type PrescribingPaths } from '../model/types'
import { IssuedPrescriptions } from './IssuedPrescriptions'
import { PrescribingForm } from './PrescribingForm'

/**
 * THE PRESCRIBING SURFACE INSIDE THE CONSULTATION ROOM.
 *
 * ====================================================================================
 * TWO HARD BLOCKS. ENFORCED, NOT WARNED.
 * ====================================================================================
 *
 * `Prescription::issue()` refuses on two preconditions and this panel refuses on the same two
 * before a clinician can type a word:
 *
 *   1. A clinician without `can_prescribe`, or without a registration number, cannot prescribe.
 *      Both are administrator-granted; `mayPrescribe()` is the conjunction.
 *   2. A consultation whose outcome does not permit it cannot carry one. That is
 *      `converted_to_in_person` — "where the clinician judged remote care unsafe, the patient
 *      is referred in person instead" — and, less obviously but just as absolutely, EVERY other
 *      outcome except `completed`, including the null outcome of a consultation that has not
 *      ended yet.
 *
 * A BLOCKED PANEL RENDERS NO FORM AT ALL. Not a disabled one. A disabled form is a promise that
 * the fields would work if only something were configured, and it invites a clinician to fill
 * one in and discover at the last press that it will not send — after a consultation, with a
 * patient waiting for a prescription. What is rendered instead is the reason and, where there
 * is one, who can change it.
 *
 * ====================================================================================
 * THE THING MOST LIKELY TO SURPRISE A READER: PRESCRIBING COMES AFTER ENDING
 * ====================================================================================
 *
 * `ConsultationOutcome::permitsPrescribing()` returns true for `Completed` and nothing else,
 * and a consultation in progress has a NULL outcome. `$consultation->outcome?->
 * permitsPrescribing() !== true` is therefore true while the encounter is live — so the API
 * will refuse a prescription issued mid-consultation.
 *
 * That is not a bug being worked around here; it follows from the record's own logic — a
 * prescription belongs to an encounter that happened, and an encounter that has not ended has
 * not yet happened in the record's terms. But it is not obvious from any screen, and a
 * clinician who does not know it will fill in the form and be refused. So the panel is present
 * throughout the consultation, says exactly this while the encounter is live, and becomes live
 * itself the moment the consultation is ended as completed.
 *
 * ------------------------------------------------------------------------------------
 * COMPOSED IN BY THE ROUTE, NOT IMPORTED BY THE ROOM. The consultations domain renders a slot
 * and this fills it; a domain may not reach into another domain, and `.dependency-cruiser.cjs`
 * enforces the direction.
 */

export type PrescribingPanelProps = {
  consultationId: string | null
  patientId: string
  patientName: string
  appointmentId: string
  /** The signed-in clinician's user id, for reading back their registration details. */
  userId: string
  /** Their name from the session, used when the profile read is refused. */
  userName: string
  /** The consultation's outcome, or null while it is still running. */
  outcome: string | null
  paths: PrescribingPaths
}

export async function PrescribingPanel({
  consultationId,
  patientId,
  patientName,
  appointmentId,
  userId,
  userName,
  outcome,
  paths,
}: PrescribingPanelProps) {
  if (consultationId === null) {
    return null
  }

  const [prescriber, prescriptions] = await Promise.all([
    readPrescriber(userId, userName),
    listPrescriptions(patientId),
  ])

  const block = prescribingBlock(prescriber, outcome)

  const back = (params: Record<string, string | undefined> = {}) => {
    const search = new URLSearchParams()

    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== '') {
        search.set(key, value)
      }
    }

    const query = search.toString()

    return query === '' ? paths.room(appointmentId) : `${paths.room(appointmentId)}?${query}`
  }

  async function cancel(formData: FormData) {
    'use server'

    const id = String(formData.get('prescription_id') ?? '').trim()
    const reason = String(formData.get('reason') ?? '').trim()

    if (id === '' || reason.length < 3) {
      return redirect(back({ problem: 'incomplete' }))
    }

    const outcomeOfCancel = await cancelPrescription(id, reason)

    if (outcomeOfCancel.kind === 'problem') {
      return redirect(back({ problem: 'cancel', message: outcomeOfCancel.message ?? undefined }))
    }

    return redirect(back())
  }

  /**
   * Mint a signed link and go to it.
   *
   * A REDIRECT TO AN EXTERNAL URL, from a server action, rather than a link rendered into the
   * page. The link is short-lived and single-purpose; putting one into the HTML would mean
   * minting it for every prescription on the screen whether or not anybody opened it, and
   * leaving live links in a page that a browser may keep.
   */
  async function openDocument(formData: FormData) {
    'use server'

    const id = String(formData.get('prescription_id') ?? '').trim()

    if (id === '') {
      return redirect(back({ problem: 'incomplete' }))
    }

    const link = await documentLink(id)

    if (link.kind === 'ready') {
      return redirect(link.url)
    }

    return redirect(
      back({
        problem: 'document',
        message:
          link.kind === 'rendering'
            ? 'The document is still being produced. Try again in a moment.'
            : (link.message ?? undefined),
      }),
    )
  }

  return (
    <Card as="section" aria-labelledby="prescribe-heading">
      {/* `<Card as="section">` plus a Stack rather than `className="card stack"` with the
          gap written out: the class pair and the inline gap were the same two decisions
          these two components make, and only one of them was checkable. */}
      <Stack gap="5">
        <div className="stack">
          <h2 id="prescribe-heading" className="title-sm">
            Prescribe
          </h2>
          <p className="fine">
            A prescription is a clinical act by you, under your own registration. Once issued it
            cannot be edited — only cancelled, with a reason, and replaced.
          </p>
        </div>

        {block === null ? (
          <PrescribingForm
            consultationId={consultationId}
            prescriber={prescriber}
            patientName={patientName}
          />
        ) : (
          <Blocked block={block} />
        )}

        {prescriber.kind === 'unreadable' && block === null ? (
          <Notice tone="info" icon="shield" title="Your registration details cannot be shown here" announce={false}>
            The endpoint that carries a registration number is open to administrators only,
            because it is also the endpoint that grants the right to prescribe. The document will
            carry what the clinic recorded for you; this screen cannot read it back to confirm it
            before you sign.
          </Notice>
        ) : null}

        <Stack gap="4">
          <h3 className="eyebrow">Recent prescriptions</h3>
          <IssuedPrescriptions
            prescriptions={prescriptions}
            cancelAction={cancel}
            documentAction={openDocument}
          />
        </Stack>
      </Stack>
    </Card>
  )
}

/** Why there is no form, and who can change it. Never a disabled control — see the header. */
function Blocked({ block }: { block: NonNullable<ReturnType<typeof prescribingBlock>> }) {
  if (block.kind === 'no-clinician-record') {
    return (
      <Notice tone="bad" icon="lock" title="This account is not a clinician of this clinic">
        Prescribing needs a clinician record — the registration body and number the clinic holds
        for you — and this account has none. A clinical role on its own is not enough. An
        administrator adds it on the staff screen.
      </Notice>
    )
  }

  if (block.kind === 'may-not-prescribe') {
    return (
      <Notice tone="bad" icon="lock" title="You cannot issue a prescription at this clinic">
        {block.reason === 'no-registration-number'
          ? 'The clinic has not recorded a registration number for you. Prescribing requires one, and only an administrator can add it.'
          : 'The clinic has not granted you prescribing rights. Only an administrator can change that.'}
      </Notice>
    )
  }

  if (block.kind === 'not-ended') {
    return (
      <Notice tone="info" icon="clock" title="End the consultation first" announce={false}>
        A prescription belongs to an encounter that has happened, and this one is still running.
        End it below with the outcome <strong>Completed</strong> and this form becomes live. That
        is enforced by the clinical record, not by this screen — filling the form in now would
        only be refused at the last step.
      </Notice>
    )
  }

  return (
    <Notice tone="bad" icon="lock" title="No prescription can be issued on this consultation">
      {block.outcome === 'converted_to_in_person'
        ? 'You ended this consultation by referring the patient for in-person care. No prescription may be issued on it — that is a hard constraint, not a warning. See the patient in person and prescribe from that consultation.'
        : 'This consultation did not complete, so nothing can be prescribed against it. Only a completed consultation carries a prescription.'}
    </Notice>
  )
}
