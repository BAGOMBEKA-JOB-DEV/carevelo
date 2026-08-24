import { Button, Card, Choice, Icon, Notice, Stack, type ChoiceOption } from '@carevelo/ui'
import { OUTCOME_LABEL, OUTCOME_NOTE, type ConsultationOutcome } from '../model/types'

/**
 * ENDING THE CONSULTATION, WHICH IS A CLINICAL ACT AND NOT A "CLOSE" BUTTON.
 *
 * ====================================================================================
 * THE OUTCOME IS REQUIRED, AND IT IS NOT PAPERWORK
 * ====================================================================================
 *
 * `EndConsultationRequest` says why: "A consultation that simply stops records nothing about
 * why, and the exception paths — no-show, clinician unavailable, remote care judged unsafe,
 * technical failure — are the ones the clinic needs to count."
 *
 * Two of the five carry consequences the clinician has to see BEFORE they choose, not
 * afterwards, and both are written next to the option rather than in a tooltip:
 *
 *   - `converted_to_in_person` FORBIDS ANY PRESCRIPTION on this consultation, permanently.
 *     `Prescription::issue()` enforces it — "where the clinician judged remote care unsafe,
 *     the patient is referred in person instead" — and there is no route around it for anyone.
 *   - `technical_failure` marks the APPOINTMENT abandoned rather than completed, which is how
 *     a clinic tells a dropped call from a consultation that happened.
 *
 * AND ONE THAT IS EASY TO MISS: `completed` IS THE ONLY OUTCOME THAT PERMITS PRESCRIBING AT
 * ALL. `ConsultationOutcome::permitsPrescribing()` returns true for `Completed` and for
 * nothing else, and a consultation still in progress has a NULL outcome — which also fails
 * the check. So a prescription cannot be issued until the encounter has been ended as
 * completed. That is stated on the prescribing panel too, because a clinician who does not
 * know it will fill in a prescription form and be refused at the last step.
 *
 * ENDING IS IRREVERSIBLE. `assertInProgress` refuses a second end: "This consultation has
 * already ended. Its record is closed; a correction is made by addendum to its notes."
 *
 * ------------------------------------------------------------------------------------
 * WHY THIS IS A RADIO GROUP AND A SUBMIT, RATHER THAN FIVE BUTTONS
 *
 * Five submit buttons post on the first press. This is the last irreversible act in the
 * encounter and it deserves a choice followed by a confirmation, in that order — the same
 * shape, and for the same reason, as the prescribing confirmation.
 */
export function EndConsultation({
  action,
  notesSaved,
}: {
  action: (formData: FormData) => Promise<void>
  /** Whether anything at all has been written. Purely to warn; it never blocks. */
  notesSaved: boolean
}) {
  const options: ChoiceOption[] = OUTCOMES.map((outcome) => ({
    value: outcome,
    label: OUTCOME_LABEL[outcome],
    note: OUTCOME_NOTE[outcome],
  }))

  return (
    <Card as="section" aria-labelledby="end-heading">
      <Stack gap="5">
        <h2 id="end-heading" className="title-sm">
          End this consultation
        </h2>

        {!notesSaved ? (
          /*
           * A WARNING AND NOT A BLOCK. A clinician who held the consultation entirely by
           * telephone and is about to write the note afterwards is doing something legitimate,
           * and a product that refused to let them close the encounter would be a product they
           * work around. Notes can still be added after ending — the API allows it deliberately.
           */
          <Notice tone="warn" icon="file" title="Nothing has been written to the record yet">
            You can still end the consultation and write the note afterwards; it will be added as
            a later entry. But an encounter with no note at all is a record that cannot answer a
            question about this patient six months from now.
          </Notice>
        ) : null}

        {/* The column is a Stack inside the form, not the form wearing `.stack`: the element
            a form renders as is decided by what it submits. Same 16px, said on the thing that
            owns the space. */}
        <form action={action}>
          <Stack gap="5">
            <Choice
              name="outcome"
              legend="How did this consultation end?"
              options={options}
              required
              hint="This is recorded on the encounter and cannot be changed afterwards. Read the note under each one — two of them stop a prescription being issued at all."
            />

            <div>
              <Button variant="primary" size="lg" type="submit">
                <Icon name="check" /> End the consultation
              </Button>
            </div>

            <p className="fine">
              Ending closes the appointment and this record. You will still be able to read the
              notes and add an addendum to any of them.
            </p>
          </Stack>
        </form>
      </Stack>
    </Card>
  )
}

/**
 * The five, in the order a clinician would consider them: the ordinary case first, then the
 * two that are somebody's absence, then the two that are a decision.
 *
 * `satisfies` ties the list to the generated union, so an outcome added to the contract breaks
 * this build rather than quietly disappearing from the form.
 */
const OUTCOMES = [
  'completed',
  'patient_no_show',
  'clinician_unavailable',
  'converted_to_in_person',
  'technical_failure',
] as const satisfies readonly ConsultationOutcome[]
