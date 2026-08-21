/**
 * The prescriptions domain's PUBLIC SURFACE.
 *
 * Prescribing, cancelling and reading back what was prescribed. Everything else in this folder
 * is internal, and `.dependency-cruiser.cjs` makes reaching past this file a build failure.
 *
 * ------------------------------------------------------------------------------------
 * WHAT THE ROUTE LAYER HAS TO DO
 *
 * One component, composed into the consultation room's `prescribing` slot:
 *
 *   <PrescribingPanel
 *     consultationId={…}   null while there is no consultation; renders nothing
 *     patientId patientName appointmentId
 *     userId={staff.id} userName={staff.name}
 *     outcome={…}          the consultation's outcome, or null while it is running
 *     paths={{ room }}
 *   />
 *
 * The room renders a SLOT and this fills it. A domain may not reach into another domain;
 * composing the two is what the route is for.
 *
 * ------------------------------------------------------------------------------------
 * THE TWO THINGS A READER OF THIS DOMAIN MUST NOT MISS
 *
 * A PRESCRIPTION IS IMMUTABLE. `PrescriptionPolicy::update()` and `delete()` both return false
 * unconditionally. There is no edit function here and no edit control anywhere in the
 * components — not even a disabled one. Correction is cancel-with-a-reason and re-issue.
 *
 * PRESCRIBING IS BLOCKED, NOT WARNED, IN FOUR CASES: no clinician record, no prescribing right
 * or no registration number, a consultation that has not ended, and a consultation whose
 * outcome is anything but `completed`. The last one catches more people than expected — it
 * means a prescription cannot be issued mid-consultation at all. `prescribingBlock()` is where
 * that logic lives and `PrescribingPanel` renders the reason instead of a form.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md §5
 */

/* ---- The panel ---- */
export { PrescribingPanel, type PrescribingPanelProps } from './components/PrescribingPanel'

/* ---- Types ---- */
export type { PrescribingPaths, Prescriber, Prescription } from './model/types'
