import { getTranslations } from 'next-intl/server'
import type { AppointmentStatus, ConsultationMode } from '../model/types'

/**
 * The two closed vocabularies this domain renders, resolved into plain records.
 *
 * WHY A RECORD AND NOT `t(\`modes.${mode}Label\`)`. `src/i18n/app-config.d.ts` types every
 * message key against the merged English catalogue, which is what turns a renamed or
 * mistyped key into a compile error instead of the literal text `Scheduling.modes.foo`
 * appearing on a patient's screen. A key assembled from a variable gives that up at
 * exactly the place it is most useful — an enum with four members, three of which are
 * rarely exercised by hand. Written out, every one of the thirteen keys below is checked.
 *
 * The cost is that adding a mode or a status means editing this file. That is the point:
 * `Record<ConsultationMode, …>` will not compile until the new member has words, so a
 * fifth mode cannot reach a patient as a blank label.
 *
 * `getTranslations` is called once per record rather than threaded through as an
 * argument. It reads the request's already-resolved configuration — there is no I/O and
 * no second catalogue load — and it keeps these functions callable from any component
 * without a translator being passed down through three layers of props.
 */

export type ModeText = { label: string; note: string }

/**
 * VOICE AND CHAT GET THE SAME AMOUNT OF EXPLANATION AS VIDEO. Look at the notes in the
 * catalogue: each of the four says what it is and what it costs in data, and none of them
 * calls one a fallback. A patient on a poor connection has to be able to choose voice
 * because it is right for them, not because video failed.
 */
export async function modeText(): Promise<Record<ConsultationMode, ModeText>> {
  const t = await getTranslations('Scheduling')

  return {
    in_person: { label: t('modes.inPersonLabel'), note: t('modes.inPersonNote') },
    video: { label: t('modes.videoLabel'), note: t('modes.videoNote') },
    voice: { label: t('modes.voiceLabel'), note: t('modes.voiceNote') },
    chat: { label: t('modes.chatLabel'), note: t('modes.chatNote') },
  }
}

export type StatusText = {
  known: Record<AppointmentStatus, string>
  /** For a state this build has not been taught. Neutral, and never blank. */
  unknown: string
}

export async function statusText(): Promise<StatusText> {
  const t = await getTranslations('Scheduling')

  return {
    known: {
      awaiting_payment: t('status.awaitingPayment'),
      payment_failed: t('status.paymentFailed'),
      confirmed: t('status.confirmed'),
      in_progress: t('status.inProgress'),
      completed: t('status.completed'),
      cancelled: t('status.cancelled'),
      no_show: t('status.noShow'),
      expired: t('status.expired'),
      abandoned: t('status.abandoned'),
    },
    unknown: t('status.unknown'),
  }
}
