import type { components, operations } from '@carevelo/api-client'

/** Every shape this domain handles, taken from the generated contract. Not one is hand-written. */

export type Prescription = components['schemas']['PrescriptionResource']
export type PrescriptionItem = components['schemas']['PrescriptionItemResource']
export type StorePrescriptionBody = components['schemas']['StorePrescriptionRequest']
export type ClinicianProfile = components['schemas']['ClinicianProfileResource']

export type PrescriptionsPage =
  operations['v1.prescriptions.index']['responses'][200]['content']['application/json']

/**
 * Where the route layer has mounted the room this panel lives inside.
 *
 * PASSED IN RATHER THAN GUESSED, so a server action can never be talked into redirecting
 * somewhere a form told it to.
 */
export type PrescribingPaths = {
  /** Back to the consultation room, for one appointment. */
  room: (appointmentId: string) => string
}

/**
 * WHO IS DOING THE PRESCRIBING, AND WHETHER THIS CONSOLE CAN EVEN SAY.
 *
 * ====================================================================================
 * A CLINICIAN CANNOT READ THEIR OWN REGISTRATION NUMBER. THAT IS A REAL GAP.
 * ====================================================================================
 *
 * The requirement is unambiguous: "Prescribing requires an explicit confirmation step showing
 * exactly what will appear on the PDF — including the clinician's own name and registration
 * number — because it is a clinical act and should feel like one."
 *
 * The registration number lives on `ClinicianProfileResource`, and the only endpoint that
 * publishes it is `GET /v1/tenant/users/{user}/clinician`. That controller calls
 * `administeredTenant()`, which throws unless the caller holds `clinic_admin`:
 *
 *   "Letting a clinician write their own would make the single most important invariant in the
 *    system self-service."
 *
 * That reasoning is about WRITING and is correct. It is applied to READING as a side effect of
 * the two sharing a controller — so a clinician about to sign a prescription cannot be shown
 * the registration number that will appear on it. The patient-facing `GET /v1/clinicians`
 * omits the number permanently and rightly.
 *
 * WHAT THIS DOMAIN DOES ABOUT IT: tries the read, and when it is refused SAYS SO on the
 * confirmation step rather than quietly printing a blank where a registration number belongs.
 * The clinician confirms the medicines, the directions and their own name; the line where the
 * number would be says that this console could not read it back and that the clinic's recorded
 * number is what the document will carry. That is honest. It is not what the requirement asks
 * for, and pretending otherwise by omitting the line would be worse.
 *
 * THE FIX IS SMALL AND IT IS IN THE HANDOVER NOTES: allow a clinician to read their OWN
 * profile — `$user->id === $request->user()->id` — on that route, or publish a
 * `clinician_profile` block on `GET /v1/me`. Either makes the confirmation complete without
 * making the capability self-service.
 */
export type Prescriber =
  /** The full profile. The confirmation can show exactly what the document will carry. */
  | { readonly kind: 'known'; readonly profile: ClinicianProfile }
  /** This account has no Clinician record at this clinic. A HARD BLOCK — see below. */
  | { readonly kind: 'none' }
  /** The API refused the read. See the note above; this is the ordinary case for a clinician. */
  | { readonly kind: 'unreadable'; readonly name: string }

/**
 * THE TWO HARD BLOCKS, IN ONE PLACE.
 *
 * Both are enforced by `Prescription::issue()` and neither is a warning:
 *
 *   1. `mayPrescribe()` — `can_prescribe` AND a non-empty registration number. Either missing
 *      and the API throws an `IllegalTransition`. Only an administrator can grant it.
 *   2. The consultation's outcome must permit prescribing, and
 *      `ConsultationOutcome::permitsPrescribing()` returns true for `completed` and NOTHING
 *      else. A consultation still in progress has a null outcome, which also fails — so a
 *      prescription cannot be issued until the encounter has been ended as completed.
 *      `converted_to_in_person` fails permanently, by design: "where the clinician judged
 *      remote care unsafe, the patient is referred in person instead".
 *
 * A blocked panel renders the reason and NO FORM AT ALL. Not a disabled form: a disabled form
 * is a promise that the fields would work if only something were configured, and it invites a
 * clinician to fill it in and then discover it will not send. What is rendered instead is the
 * reason and, where there is one, who can change it.
 */
export type PrescribingBlock =
  | { readonly kind: 'no-clinician-record' }
  | { readonly kind: 'may-not-prescribe'; readonly reason: 'not-permitted' | 'no-registration-number' }
  | { readonly kind: 'not-ended' }
  | { readonly kind: 'outcome'; readonly outcome: string }

/**
 * Is prescribing blocked, and by what?
 *
 * `null` means it is not — which is not the same as "the API will accept it". The
 * `unreadable` prescriber case cannot be checked here at all, and this function says so by
 * NOT blocking: refusing to render a form because we could not read a permission would stop a
 * clinician prescribing for a reason that may not exist. The API is the enforcement; this is
 * the part of it that can be shown early.
 */
export function prescribingBlock(
  prescriber: Prescriber,
  outcome: string | null,
): PrescribingBlock | null {
  if (prescriber.kind === 'none') {
    return { kind: 'no-clinician-record' }
  }

  if (prescriber.kind === 'known' && !prescriber.profile.may_prescribe) {
    return {
      kind: 'may-not-prescribe',
      reason:
        prescriber.profile.registration_number.trim() === ''
          ? 'no-registration-number'
          : 'not-permitted',
    }
  }

  if (outcome === null) {
    return { kind: 'not-ended' }
  }

  if (outcome !== 'completed') {
    return { kind: 'outcome', outcome }
  }

  return null
}
