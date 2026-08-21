import type { ConsultationMode, Slot } from './types'

/**
 * Getting a chosen slot from the browser back to the server through a native form post.
 *
 * A SLOT IS THREE FACTS — which clinician, from when, until when — AND A RADIO POSTS ONE
 * VALUE. The alternatives are worse: three parallel hidden inputs kept in step by JavaScript
 * stop working the moment the bundle has not arrived, and this console is opened on a
 * handset in a corridor; a form per row is a form per row. So the three travel as one opaque
 * string and are taken apart on the server.
 *
 * IT IS NOT A TRUST BOUNDARY AND MUST NOT BE MISTAKEN FOR ONE. Anything that arrives through
 * a form is the sender's to edit. `decodeSlot` checks only that the shape is one this domain
 * can act on; whether the clinician exists, whether the slot is inside the clinic's hours and
 * whether it is still free are decided by the API inside the booking transaction, which is
 * the only place they can be decided correctly. The separator is chosen because it cannot
 * appear in either half — ULIDs are Crockford base-32 and ISO-8601 has no pipe — which makes
 * the decode unambiguous, not safe.
 *
 * DELIBERATELY THE SAME AS `apps/patient-portal/src/domains/scheduling/model/slots.ts`, and
 * deliberately a second copy: `no-app-to-app` forbids importing across apps, because the two
 * are deployed separately so a bug in one cannot take the other down. The encoding is part of
 * neither app's contract with the other — each posts to itself — so the duplication carries
 * no coupling. If a third app needs it, it belongs in `packages/ui`.
 */

const SEPARATOR = '|'

export function encodeSlot(slot: Slot): string {
  return [slot.clinician_id, slot.starts_at, slot.ends_at].join(SEPARATOR)
}

export type DecodedSlot = { clinicianId: string; startsAt: string; endsAt: string }

export function decodeSlot(value: string): DecodedSlot | null {
  const parts = value.split(SEPARATOR)

  if (parts.length !== 3) {
    return null
  }

  const [clinicianId, startsAt, endsAt] = parts

  if (!clinicianId || !startsAt || !endsAt) {
    return null
  }

  if (Number.isNaN(Date.parse(startsAt)) || Number.isNaN(Date.parse(endsAt))) {
    return null
  }

  return { clinicianId, startsAt, endsAt }
}

/**
 * The four modes, in the order the enum declares them.
 *
 * PRESENTED AS EQUALS, AND THE ORDER IS NOT A RANKING. A receptionist booking for a caller
 * who says "I have no data at home" must be able to choose voice deliberately rather than
 * book video and hope. Nothing in this domain marks one as a fallback, dims one, or hides one
 * behind a disclosure.
 */
export const CONSULTATION_MODES = ['in_person', 'video', 'voice', 'chat'] as const

export function isConsultationMode(value: string): value is ConsultationMode {
  return (CONSULTATION_MODES as readonly string[]).includes(value)
}

/**
 * The modes a service may actually be booked in.
 *
 * `StoreAppointmentRequest::assertServiceOffersMode()` enforces the clinic's own
 * configuration, and that judgement is clinical and theirs. An EMPTY list on the resource
 * means the clinic has expressed no restriction, which the backend reads as "any" — so the
 * same reading is used here rather than an empty picker nobody can get past.
 */
export function bookableModes(modes: readonly string[]): ConsultationMode[] {
  const offered = modes.filter(isConsultationMode)

  return offered.length > 0 ? offered : [...CONSULTATION_MODES]
}

/**
 * How many times to put on the page at once.
 *
 * The API returns up to five hundred. A receptionist with a caller on the line reads the
 * first handful and asks "does half past two suit you?"; nobody scrolls two hundred radio
 * rows with somebody waiting. What is cut is said on screen rather than silently dropped,
 * with the day and clinician filters as the way to reach the rest.
 */
export const MAX_SLOTS_SHOWN = 48

/** `prepaid` or `pay_at_clinic`. Narrowed from an untrusted form value. */
export function isPaymentExpectation(value: string): value is 'prepaid' | 'pay_at_clinic' {
  return value === 'prepaid' || value === 'pay_at_clinic'
}
