import { Badge, Button, DateTime, Field, Icon, Inline, Stack, Textarea } from '@carevelo/ui'
import type { Prescription } from '../model/types'

/**
 * What this patient has been prescribed at this clinic, most recent first.
 *
 * ====================================================================================
 * IT SAYS "RECENTLY", NOT "IN THIS CONSULTATION", AND THAT WORDING IS LOAD-BEARING
 * ====================================================================================
 *
 * `v1.prescriptions.index` filters on `patient_id` and `status`, and `PrescriptionResource`
 * does not publish `consultation_id` — so there is no way, from either end, to narrow this to
 * the encounter the clinician is currently in.
 *
 * Captioning it "issued in this consultation" would therefore be a caption that is sometimes a
 * lie, and the consequence of that particular lie is specific: a clinician cancelling what
 * they believe is today's duplicate would cancel last month's repeat, and cancellation is
 * irreversible. So the caption says what the list actually is.
 *
 * ====================================================================================
 * THERE IS NO EDIT CONTROL, AND NOT A DISABLED ONE EITHER
 * ====================================================================================
 *
 * `PrescriptionPolicy::update()` and `delete()` both return false unconditionally. A
 * prescription is corrected by cancelling it with a reason and issuing another. A greyed-out
 * pencil would teach a clinician that editing is a thing this product does and that somebody
 * merely lacks permission for it.
 */
export function IssuedPrescriptions({
  prescriptions,
  cancelAction,
  documentAction,
}: {
  prescriptions: readonly Prescription[]
  /** Bound by the panel: posts `prescription_id` and `reason`. */
  cancelAction: (formData: FormData) => Promise<void>
  /** Bound by the panel: posts `prescription_id`, mints a signed link and redirects to it. */
  documentAction: (formData: FormData) => Promise<void>
}) {
  if (prescriptions.length === 0) {
    return (
      <p className="muted">
        Nothing has been prescribed for this patient at this clinic recently.
      </p>
    )
  }

  return (
    <Stack gap="5">
      <p className="fine">
        This patient&rsquo;s recent prescriptions at this clinic — not only the ones from this
        consultation. The API cannot narrow the list to one encounter; check the date before
        cancelling anything.
      </p>

      {prescriptions.map((prescription) => (
        <Stack as="article" key={prescription.id} className="card" gap="4">
          <Inline gap="4" justify="between">
            <span className="tnum">
              {prescription.issued_at === null ? (
                'Date not recorded'
              ) : (
                <DateTime value={prescription.issued_at} format="datetime" />
              )}
            </span>
            <Badge tone={STATUS_TONE[prescription.status] ?? 'neutral'}>
              {STATUS_LABEL[prescription.status] ?? prescription.status}
            </Badge>
          </Inline>

          <ul className="stack" style={{ gap: 'var(--space-2)', listStyle: 'none' }}>
            {(prescription.items ?? []).map((item) => (
              <li key={item.id} className="row-wrap" style={{ gap: 'var(--space-3)' }}>
                <span>
                  {[item.medicine_name, item.strength, item.form].filter(Boolean).join(' ')} —{' '}
                  {item.quantity} {item.unit ?? ''} — {item.directions}
                </span>
                {item.is_controlled ? <Badge tone="warn">Controlled</Badge> : null}
              </li>
            ))}
          </ul>

          <p className="fine">
            Issued by {prescription.issued_by.name} ·{' '}
            {prescription.issued_by.registration_body.toUpperCase()}{' '}
            {prescription.issued_by.registration_number}. Recorded by the clinic and never
            verified by Carevelo.
          </p>

          <Inline gap="3">
            {/*
              * THE LINK IS MINTED WHEN IT IS ASKED FOR, NOT WHEN THE PAGE RENDERS. The document
              * never sits at a public or guessable path; this endpoint is the only way to reach
              * one, and it authorises before any URL exists. Prefetching a signed link for
              * every prescription on screen would create live links nobody opened.
              */}
            <form action={documentAction}>
              <input type="hidden" name="prescription_id" value={prescription.id} />
              <Button variant="quiet" type="submit">
                <Icon name="file" /> Open the document
              </Button>
            </form>

            {prescription.status === 'issued' ? (
              <CancelPrescription id={prescription.id} action={cancelAction} />
            ) : null}
          </Inline>
        </Stack>
      ))}
    </Stack>
  )
}

/**
 * Cancelling, with the reason the API requires and the warning it cannot give.
 *
 * THE REASON IS MANDATORY AND THE HINT SAYS WHY, in the API's own terms: "The document has left
 * the building and may already be on someone's phone. A cancellation with no recorded reason
 * leaves the next reader — the pharmacist, the patient, an auditor — unable to tell a
 * transcription slip from a clinical reversal."
 *
 * Unlike a cancellation reason on an appointment, this one is EXPECTED to be clinical and is
 * stored on the record rather than in the audit event for exactly that reason. So the hint
 * does not tell the clinician to keep it non-clinical — it tells them the opposite.
 */
function CancelPrescription({
  id,
  action,
}: {
  id: string
  action: (formData: FormData) => Promise<void>
}) {
  return (
    <details>
      <summary className="lnk disclose">
        <Icon name="x" /> Cancel this prescription
      </summary>

      <form action={action} className="stack" style={{ gap: 'var(--space-4)', marginTop: 'var(--space-4)' }}>
        <input type="hidden" name="prescription_id" value={id} />

        <Field
          name={`reason-${id}`}
          label="Why is this being cancelled?"
          hint="Say whether this is a clinical reversal or a mistake in what was written. The pharmacist, the patient and any later reader depend on being able to tell those apart. This stays on the record and is deliberately kept out of the audit log."
        >
          {(control) => <Textarea {...control} name="reason" required minLength={3} rows={2} />}
        </Field>

        <div>
          <Button variant="danger" type="submit">
            Cancel this prescription
          </Button>
        </div>
      </form>
    </details>
  )
}

const STATUS_LABEL: Record<string, string> = {
  issued: 'Issued',
  cancelled: 'Cancelled',
  superseded: 'Superseded',
}

const STATUS_TONE: Record<string, 'good' | 'neutral' | 'warn'> = {
  issued: 'good',
  cancelled: 'neutral',
  superseded: 'neutral',
}
