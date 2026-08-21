import { getTranslations } from 'next-intl/server'
import { Notice } from '@carevelo/ui'
import {
  asMode,
  asOutcome,
  type Consultation,
  type ConsultationMode,
  type ConsultationOutcome,
} from '../api/consultations'

/**
 * What mode this consultation is actually being held in, and — when that is not what was
 * booked — what happened.
 *
 * THE PATIENT IS TOLD. That is the requirement, in those words: "Video → voice → chat,
 * with the patient told what happened rather than left watching a frozen frame." A
 * step-down that is recorded in the clinic's reporting and nowhere the patient can see it
 * satisfies the audit and fails the person.
 *
 * IT IS READ, NOT GUESSED. `mode_used` on the consultation is the truth — the clinician's
 * client reports the transition and the API records it; the appointment's `mode_booked` is
 * left alone as the record of what was agreed. So this component renders the difference
 * between two facts rather than monitoring the connection and forming an opinion. Nothing
 * here can disagree with what the clinic will later report, because it is the same field.
 *
 * WHY THE PATIENT PORTAL DOES NOT REPORT A STEP-DOWN ITSELF. POST /v1/consultations/{id}/mode
 * is authorised by ConsultationPolicy::conduct, which requires ClinicalRole::Clinician. A
 * patient calling it gets a 403 — so a "switch me to voice" control here would be a button
 * that fails, and a client-side degradation monitor here would be a monitor whose findings
 * have nowhere to go. Reading is the honest half of that endpoint from this side. The gap
 * is written up in the handover notes rather than papered over with a control that looks
 * like it works.
 *
 * SERVER-RENDERED, so it is correct in the first HTML byte and correct again on every
 * refresh, with or without JavaScript.
 *
 * @see docs/10-product/prd-h3-teleconsultation.md §4 — recorded truthfully in mode_used
 * @see backend/app/Policies/ConsultationPolicy.php — `conduct`
 */

const MODE_KEY = {
  video: 'mode.video',
  voice: 'mode.voice',
  chat: 'mode.chat',
  in_person: 'mode.inPerson',
} as const satisfies { readonly [M in ConsultationMode]: string }

const OUTCOME_KEY = {
  completed: 'endedCompleted',
  converted_to_in_person: 'endedConverted',
  technical_failure: 'endedTechnicalFailure',
  patient_no_show: 'endedPatientNoShow',
  clinician_unavailable: 'endedClinicianUnavailable',
} as const satisfies { readonly [O in ConsultationOutcome]: string }

/**
 * How much of a connection each mode asks for, ordered.
 *
 * Used only to tell a step DOWN from a step back up, so that the sentence can say which
 * happened. The state machine allows both directions and a record that admitted only
 * degradation would be no more truthful than one that admitted neither.
 */
const DEMAND: { readonly [M in ConsultationMode]: number } = {
  chat: 0,
  voice: 1,
  video: 2,
  // Not reachable on a remote consultation — RecordModeRequest refuses `in_person`,
  // because a remote consultation does not become an in-person one by changing a field.
  // Ranked highest so that if one ever appears, it does not read as a degradation.
  in_person: 3,
}

export async function ModeStrip({
  clinic,
  bookedMode,
  consultation,
}: {
  clinic: string
  bookedMode: ConsultationMode | null
  consultation: Consultation
}) {
  const t = await getTranslations('Consultations')

  if (consultation.ended_at !== null) {
    const outcome = asOutcome(consultation.outcome)

    return (
      <Notice tone="neutral" icon="check" title={t('endedTitle')}>
        {outcome === null ? t('endedGeneric', { clinic }) : t(OUTCOME_KEY[outcome], { clinic })}
      </Notice>
    )
  }

  const used = asMode(consultation.mode_used)

  if (used === null) {
    // A mode the contract does not know about. Saying nothing is better than asserting
    // something wrong about how a patient is being seen; the rest of the room still works.
    return null
  }

  const mode = t(MODE_KEY[used])

  if (bookedMode === null || bookedMode === used) {
    return (
      <Notice tone="info" icon="activity" title={t('modeHeldTitle', { mode })} announce={false}>
        {t('modeHeldBody')}
      </Notice>
    )
  }

  const booked = t(MODE_KEY[bookedMode])
  const steppedDown = DEMAND[used] < DEMAND[bookedMode]

  return steppedDown ? (
    <Notice tone="warn" icon="activity" title={t('modeSteppedDownTitle', { booked, mode })}>
      {t('modeSteppedDownBody', { booked, mode })}
    </Notice>
  ) : (
    <Notice tone="info" icon="activity" title={t('modeSteppedUpTitle', { booked, mode })}>
      {t('modeSteppedUpBody')}
    </Notice>
  )
}
