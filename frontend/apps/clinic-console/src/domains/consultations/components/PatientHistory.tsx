import { Badge, Card, DateTime, EmptyState, Inline, Notice, Stack } from '@carevelo/ui'
import { asMode, asOutcome, MODE_LABEL, OUTCOME_LABEL, type Consultation, type Patient } from '../model/types'

/**
 * THE PATIENT'S HISTORY WITHIN THIS TENANT — and the second half of that phrase is the point.
 *
 * ====================================================================================
 * THIS IS NOT THE PATIENT'S MEDICAL HISTORY. IT IS THIS CLINIC'S.
 * ====================================================================================
 *
 * `GET /v1/consultations?patient_id=` runs under row-level security, so what comes back is
 * what THIS clinic has recorded about this person. There is no cross-clinic patient history in
 * Carevelo and there will not be one: the isolation boundary between clinics is absolute.
 *
 * A clinician who reads this list as "everything this patient has been seen for" will make a
 * decision on it. So the panel says what it is, in a standing line that does not dismiss —
 * this is the one place on the whole screen where an unstated limitation could cause harm.
 *
 * ====================================================================================
 * WHAT IS IN IT, AND WHAT IS DELIBERATELY NOT
 * ====================================================================================
 *
 * `ConsultationResource` carries who, when, in which mode and with what outcome, and no
 * clinical content at all. That is why this panel can be rendered beside a live consultation
 * without every glance at it counting as a read of the patient's notes: the notes are a
 * separate, separately-audited endpoint, and opening a past encounter's notes is a deliberate
 * act with its own audit event rather than a side effect of loading a screen.
 *
 * There is no link into a past encounter's notes here yet, and that is honest rather than
 * finished: the read exists (`GET /v1/consultations/{id}/notes`) and the screen for it belongs
 * to the patients domain, which owns the record view. Adding a second one here would be two
 * places to keep in step and two audit trails to explain.
 */
export function PatientHistory({
  patient,
  history,
}: {
  patient: Patient | null
  history: readonly Consultation[]
}) {
  return (
    <Card as="section" aria-labelledby="history-heading">
      <Stack gap="4">
        <h2 id="history-heading" className="title-sm">
          Seen here before
        </h2>

        {patient !== null && patient.status !== 'active' ? (
          /*
           * `pending_consent` is not a formality. A record in that state may carry no clinical
           * data at all — enforced in the database, not by this screen — so a note written here
           * may be refused. A clinician who cannot see why their note will not save will find a
           * way around the product, which is exactly what this line exists to prevent.
           */
          <Notice tone="warn" icon="shield" title={`This record is ${patient.status.replace(/_/g, ' ')}`}>
            Consent has not been captured for this patient. Clinical data may be refused by the
            clinic&rsquo;s record until the front desk completes it — if a note will not save,
            that is why.
          </Notice>
        ) : null}

        {history.length === 0 ? (
          <EmptyState icon="file" title="No previous consultations at this clinic">
            Either this is their first, or they have been seen elsewhere. This console can only
            ever show you what this clinic has recorded.
          </EmptyState>
        ) : (
          /*
           * `<Stack as="ul">` strips the user-agent's bullets and indent AND puts `role="list"`
           * back on, which Safari drops from any element whose `list-style` is `none`. The
           * hand-written version set `listStyle: 'none'` and did not restore the role, so this
           * stopped being announced as "list, 6 items" on exactly the browser a clinician
           * between rooms is most likely to be holding.
           */
          <Stack as="ul" gap="3">
            {history.map((consultation) => {
              const mode = asMode(consultation.mode_used)
              const outcome = asOutcome(consultation.outcome)

              return (
                /* The style said `gap: var(--space-4)`, which is exactly what `.row-wrap`
                   already sets — nothing to say, so nothing is said. Inline has no `li` in
                   its element list, and should not: a list item belongs to its list. */
                <li key={consultation.id} className="row-wrap between">
                  <span className="tnum">
                    {consultation.started_at === null ? (
                      'Date not recorded'
                    ) : (
                      <DateTime value={consultation.started_at} format="date" />
                    )}
                  </span>

                  <Inline as="span" gap="2">
                    {mode === null ? null : <Badge tone="neutral">{MODE_LABEL[mode]}</Badge>}
                    {outcome === null ? (
                      <Badge tone="info">Not yet ended</Badge>
                    ) : (
                      <Badge tone={outcome === 'completed' ? 'good' : 'neutral'}>
                        {OUTCOME_LABEL[outcome]}
                      </Badge>
                    )}
                  </Inline>
                </li>
              )
            })}
          </Stack>
        )}

        <p className="fine">
          This clinic&rsquo;s record of this patient only. Carevelo keeps no history across
          clinics and cannot tell you whether they have been seen anywhere else.
        </p>
      </Stack>
    </Card>
  )
}
