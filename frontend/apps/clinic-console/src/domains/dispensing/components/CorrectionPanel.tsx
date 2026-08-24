import { Card, Notice } from '@carevelo/ui'

/**
 * A wrong item, found after the fact.
 *
 * ------------------------------------------------------------
 * READ THIS BEFORE ADDING AN EDIT CONTROL HERE. THERE IS NOT SUPPOSED TO BE ONE.
 *
 * The PRD's exception table is unambiguous: "Wrong item dispensed, discovered later —
 * recorded as a correction event on the order, NEVER A SILENT EDIT; escalated to the
 * administrator." A dispensed line is a record of what physically changed hands. Editing it
 * afterwards does not correct anything — it destroys the only evidence that the wrong thing
 * was handed over, which is the fact the clinician, the patient and any subsequent inquiry
 * actually need.
 *
 * ------------------------------------------------------------
 * AND THE CORRECTION EVENT DOES NOT EXIST IN THE API YET. SAYING SO IS THE HONEST SCREEN.
 *
 * There is no `POST /v1/dispense-orders/{id}/corrections` in `docs/40-api/openapi.yaml`,
 * and `DispenseOrderController` has no method for one. `price()` is reachable again, but
 * only from `under_review` or `awaiting_substitution` — a dispensed order is past both, and
 * the state machine refuses. So there is nothing this console could call, and the two
 * options are to say that plainly or to build a control that appears to work.
 *
 * A stub that mimics a feature is the failure this codebase has already named once, in
 * `PlannedSection`: "it teaches a clinic to expect something that is not there and teaches
 * us nothing when it breaks." On a screen about a medicine handed to the wrong person, a
 * control that silently did nothing would be considerably worse than that.
 *
 * So this panel tells the pharmacist what to do OUTSIDE the product — escalate to the
 * administrator, who has the audit trail — and states what will and will not happen to the
 * record. When the endpoint lands, the form goes here and this comment goes with it.
 */
export function CorrectionPanel() {
  return (
    <Card as="section" aria-labelledby="correction">
      <div className="stack">
        <h2 id="correction">Something was dispensed in error</h2>

        <Notice tone="warn" title="The record stands. It is corrected, never edited.">
          What was dispensed is a record of what physically changed hands, and nothing on
          this screen edits it. Editing would remove the only evidence that the wrong item
          went out — which is exactly the fact the prescribing clinician and the patient
          need.
        </Notice>

        <p className="muted">
          Escalate to the clinic administrator now, and contact the patient. The
          administrator has the order&rsquo;s full audit trail, including who dispensed it and
          when.
        </p>

        <p className="muted">
          Recording the correction against the order is not yet something this console can
          do — the API has no endpoint for it, and a button here that quietly did nothing
          would be worse than none. Until it exists, the correction lives in the clinic&rsquo;s
          own escalation, and this order keeps saying what it says.
        </p>
      </div>
    </Card>
  )
}
