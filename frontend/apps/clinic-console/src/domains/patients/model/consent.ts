import type { BadgeTone } from '@carevelo/ui'
import type { ConsentType } from '../api/types'

/**
 * The vocabulary of consent, in the words a front-desk user says out loud.
 *
 * WHY THE LABELS ARE HERE RATHER THAN IN THE SCREEN. The consent screen, the record summary
 * and the history list all name the same three consents, and a desk that reads "Telemedicine"
 * on one screen and "Remote consultations" on another has two things to explain to the
 * patient instead of one. The patient meanwhile is reading the API's own policy text, which
 * uses a third form of words — that one is legally operative and is never paraphrased, so the
 * least this file can do is not add a fourth.
 *
 * `ask` IS WRITTEN TO BE SPOKEN. It is the sentence a receptionist reads to somebody across a
 * counter, not a heading. That is the whole difference between facilitating a decision and
 * collecting a signature: the patient has to be told what they are agreeing to in a form they
 * can answer, and the policy document alone — forty lines on a monitor turned half away from
 * them — is not that.
 */

type ConsentDisplay = {
  readonly label: string
  /** What it actually permits, for the record summary. */
  readonly purpose: string
  /** The question, phrased to be read aloud to the patient. */
  readonly ask: string
}

/**
 * Keyed by the contract's own union, so a fourth consent type added to `StoreConsentRequest`
 * is a compile error here rather than an unlabelled button on the highest-stakes screen in
 * the product.
 */
const DISPLAY: Record<ConsentType, ConsentDisplay> = {
  data_processing: {
    label: 'Use of health information',
    purpose: 'Using this patient\'s information to provide and administer their care.',
    ask:
      'May we use your information to provide your care here? Without this, nothing else '
      + 'can proceed.',
  },
  telemedicine: {
    label: 'Remote consultations',
    purpose: 'Consulting a clinician by video, voice or chat rather than in person.',
    ask: 'May we consult you remotely — by video or by voice — as well as in person?',
  },
  delivery_disclosure: {
    label: 'Sharing an address with a delivery rider',
    purpose: 'Giving a rider the name, phone number and address needed to deliver medicines.',
    ask:
      'If you choose to have medicines delivered, may we give the rider your name, phone '
      + 'number and address? They are never given your diagnosis or your medicines.',
  },
}

/**
 * The display for a consent type, tolerating one this build has never heard of.
 *
 * `ConsentRecordResource.consent_type` is a bare `string` on the wire, and the list of types
 * the clinic collects comes from the POLICY endpoint rather than from this file — so a type
 * added to the API before this vocabulary learns about it is expected, not exceptional. It
 * falls through to the raw value, because the desk reading an unfamiliar key in a consent
 * history is better off than reading a blank.
 */
export function consentDisplay(type: string): ConsentDisplay {
  return (
    DISPLAY[type as ConsentType] ?? {
      label: type,
      purpose: 'This console does not recognise this consent type.',
      ask:
        'This console does not have wording for this consent. Show the patient the policy '
        + 'text on this screen and check with an administrator before recording anything.',
    }
  )
}

/** Whether this console knows how to put a consent question to a patient in words. */
export function isKnownConsentType(type: string): type is ConsentType {
  return Object.hasOwn(DISPLAY, type)
}

/**
 * `delivery_disclosure` IS NOT CAPTURED AT THE DESK, and the reason is a rule rather than a
 * scoping decision.
 *
 * Consent must be SPECIFIC. Asking at registration for a disclosure that may never happen is
 * not specific — the patient has not chosen delivery and may never choose it — so
 * `ConsentController` refuses it outright while the record is still `pending_consent`, and H4
 * takes it at the moment the patient picks delivery over collection instead. The consent
 * screen renders this type as an explanation rather than as a pair of buttons, because a
 * disabled button with no reason beside it teaches staff that the product is broken.
 */
export const CAPTURED_AT_DELIVERY: ConsentType = 'delivery_disclosure'

/** The badge for a decision. A word first; the colour is only reinforcement. */
export function actionDisplay(action: string): { readonly label: string; readonly tone: BadgeTone } {
  switch (action) {
    case 'granted':
      return { label: 'Granted', tone: 'good' }
    case 'declined':
      return { label: 'Declined', tone: 'neutral' }
    /*
     * `warn`, NOT `bad`. Withdrawing is a right being exercised correctly and a patient doing
     * exactly what the policy told them they could do. Painting it red would tell the desk
     * that something had gone wrong and invite them to try to talk the patient out of it.
     */
    case 'withdrawn':
      return { label: 'Withdrawn', tone: 'warn' }
    default:
      return { label: action, tone: 'neutral' }
  }
}
