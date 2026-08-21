import type { IconName } from '@carevelo/ui'
import type { ConsultationMode, Slot } from './types'

/**
 * Getting a chosen slot from the browser back to the server, through a native form post.
 *
 * A SLOT IS THREE FACTS — which clinician, from when, until when — AND A RADIO POSTS ONE
 * VALUE. The alternatives were considered and are worse: three parallel hidden inputs
 * kept in step by JavaScript stop working the moment the bundle has not arrived, which is
 * the connection this whole surface is built for; and a per-slot form is a form per row.
 * So the three travel as one opaque string and are taken apart on the server.
 *
 * IT IS NOT A TRUST BOUNDARY AND MUST NOT BE MISTAKEN FOR ONE. Anything that comes back
 * through a form is the patient's to edit. `decodeSlot` therefore checks only that the
 * shape is one this domain can act on; whether the clinician exists, whether the slot is
 * inside the clinic's hours and whether it is still free are all decided by the API,
 * inside the booking transaction, where they can be decided correctly. A separator that
 * cannot appear in either half — ULIDs are Crockford base-32 and ISO-8601 has no pipe —
 * is what keeps the decode unambiguous rather than what keeps it safe.
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
 * PRESENTED AS EQUALS, AND THE ORDER IS NOT A RANKING. Voice and chat are first-class
 * bookable modes: a patient who knows their connection will not carry video must be able
 * to choose voice deliberately rather than fight a failing video call. Nothing in this
 * domain marks one as a fallback, dims one, or hides one behind a disclosure.
 */
export const CONSULTATION_MODES = ['in_person', 'video', 'voice', 'chat'] as const

export function isConsultationMode(value: string): value is ConsultationMode {
  return (CONSULTATION_MODES as readonly string[]).includes(value)
}

/**
 * The modes a service may actually be booked in.
 *
 * A service the clinic does not offer by video cannot be booked by video —
 * `StoreAppointmentRequest::assertServiceOffersMode()` enforces the clinic's own
 * configuration, and that judgement is clinical and theirs. An EMPTY list on the resource
 * means the clinic has expressed no restriction, which the backend treats as "any", so
 * the same reading is used here rather than an empty picker the patient cannot get past.
 */
export function bookableModes(modes: readonly string[]): ConsultationMode[] {
  const offered = modes.filter(isConsultationMode)

  return offered.length > 0 ? offered : [...CONSULTATION_MODES]
}

/**
 * How many times to put on the page at once.
 *
 * The API will return up to five hundred. Rendering five hundred radio rows onto a
 * mid-range Android over mobile data is a page that scrolls for a minute and costs real
 * money in data to receive — and a patient choosing between times does not read past the
 * first few dozen. What is cut is said plainly on screen rather than silently dropped,
 * with the day and clinician filters as the way to reach the rest.
 */
export const MAX_SLOTS_SHOWN = 48

/**
 * A glyph beside each mode.
 *
 * DECORATION ONLY, AND EQUAL BY CONSTRUCTION. `Icon` is `aria-hidden` by design, so none
 * of these adds or subtracts meaning; each mode gets exactly one, at one size, so the
 * four read as four choices rather than one choice and three consolations. The word next
 * to it is what carries the meaning.
 */
export const MODE_ICON: Record<ConsultationMode, IconName> = {
  in_person: 'pin',
  video: 'users',
  voice: 'phone',
  chat: 'mail',
}
