import { cookies } from 'next/headers'
import type { ConsentAction, ConsentType } from './types'

/**
 * Carrying the just-registered patient from the registration form to the consent screen.
 *
 * THE PROBLEM. Registration and consent are two screens and, on this surface, two native
 * form posts — the journey has to work before the JavaScript bundle arrives. The second
 * screen needs the identifier the first one created, and the browser is the only thing that
 * travels between them.
 *
 * WHY A COOKIE RATHER THAN `?patient=<id>`, WHICH IS THE OBVIOUS ANSWER. A patient record
 * identifier in a URL is a URL that goes into browser history on a handset that is very
 * often shared, into the `Referer` of anything the page links to, and into the access log of
 * every hop in front of the portal. Under the DPPA the mere FACT that a person is a patient
 * of a named clinic is special-category data — it is the reason an unknown subdomain reveals
 * nothing and a cross-tenant read is a 404 — so putting the identifier where it accumulates
 * would undo, for free, a boundary the rest of the system spends real effort defending.
 * httpOnly keeps it away from script; the short life keeps it from becoming residue.
 *
 * WHAT THIS IS NOT: authorisation. It is a pointer, not a capability. Every consent call it
 * leads to is authorised by the API against the session, and a forged value reaches a 404 or
 * a 401 exactly as a typed one would. Nothing here is trusted for anything but "which record
 * was this browser part-way through registering".
 *
 * @see docs/50-security-compliance/data-protection-dppa.md
 */

const COOKIE = 'carevelo.registration'

/**
 * Thirty minutes. Long enough to read a consent policy properly — which is the whole point
 * of showing it in full — and short enough that an abandoned registration on a borrowed
 * phone is not still pointing at a stranger's record an hour later.
 */
const MAX_AGE = 60 * 30

export type RegistrationHandoff = {
  readonly patientId: string
  /**
   * Whether this record needs a guardian to consent on the patient's behalf.
   *
   * Carried rather than re-derived, because the consent screen cannot read the record to
   * find out: a patient in `pending_consent` has no account, and the registration response
   * is the one moment the date of birth is known. The API is still the authority — it
   * refuses a minor's own tick with "A patient under 18 consents through a guardian" — so
   * getting this wrong produces a clear refusal rather than an invalid consent record.
   */
  readonly guardianRequired: boolean
  /**
   * What this browser has already decided, so the consent screen does not ask twice.
   *
   * A SELF-REGISTERING PATIENT CANNOT READ THEIR OWN CONSENT HISTORY — they have no account
   * yet, and `GET /v1/patients/{id}/consents` is behind a session. So the screen has no way
   * to reflect a decision back except to remember it here, and without that a patient who
   * agreed to data processing and returned for the telemedicine question would be shown the
   * first one again as though nothing had happened.
   *
   * DISPLAY ONLY, AND NEVER A GATE. The API decides what a record is allowed to do next; a
   * value in here is only ever the reason a button is already ticked off on screen. That is
   * why it being wrong — a stale cookie, a decision recorded at the desk in the meantime —
   * costs a redundant question rather than an invalid consent.
   */
  readonly decided?: Readonly<Partial<Record<ConsentType, ConsentAction>>> | undefined
}

/**
 * Remember the record this browser just created.
 *
 * Only callable from a Server Action or a Route Handler — Next refuses a cookie write during
 * a page render, and every caller here is an action.
 */
export async function rememberRegistration(handoff: RegistrationHandoff): Promise<void> {
  const jar = await cookies()

  jar.set({
    name: COOKIE,
    value: JSON.stringify(handoff),
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE,
    // Locally the portal is plain http on a .localhost host, where a Secure cookie is a
    // cookie the browser silently drops — and a silently dropped handoff is a consent screen
    // that says the registration expired.
    secure: process.env.NODE_ENV === 'production',
  })
}

/**
 * The record this browser is part-way through registering, or null.
 *
 * PARSED DEFENSIVELY. This value comes back off the wire, and while it is httpOnly the only
 * thing that guarantees is that our own script did not write it. A malformed or hostile
 * value answers null and the consent route asks the patient to start again, which is a
 * worse afternoon than a crash but a much better one than a 500 with a stack in it.
 */
export async function readRegistrationHandoff(): Promise<RegistrationHandoff | null> {
  const jar = await cookies()
  const raw = jar.get(COOKIE)?.value

  if (!raw) {
    return null
  }

  try {
    const parsed: unknown = JSON.parse(raw)

    if (parsed === null || typeof parsed !== 'object') {
      return null
    }

    const { patientId, guardianRequired } = parsed as Record<string, unknown>

    if (typeof patientId !== 'string' || patientId === '') {
      return null
    }

    return {
      patientId,
      guardianRequired: guardianRequired === true,
      decided: readDecided((parsed as Record<string, unknown>).decided),
    }
  } catch {
    return null
  }
}

/**
 * The decisions in the cookie, keeping only values this domain recognises.
 *
 * An unknown consent type or an unknown action is dropped rather than carried, so a value
 * from an older release cannot reach the rendering code as a key nothing has a label for.
 */
function readDecided(value: unknown): Readonly<Partial<Record<ConsentType, ConsentAction>>> {
  if (value === null || typeof value !== 'object') {
    return {}
  }

  const types: readonly string[] = ['data_processing', 'telemedicine', 'delivery_disclosure']
  const actions: readonly string[] = ['granted', 'declined', 'withdrawn']
  const decided: Partial<Record<ConsentType, ConsentAction>> = {}

  for (const [type, action] of Object.entries(value as Record<string, unknown>)) {
    if (types.includes(type) && typeof action === 'string' && actions.includes(action)) {
      decided[type as ConsentType] = action as ConsentAction
    }
  }

  return decided
}

/**
 * Note one more decision against the registration this browser is part-way through.
 *
 * Read-modify-write rather than a second cookie per consent type: the whole handoff is one
 * fact — "where this browser is in the registration journey" — and splitting it would leave
 * a decision cookie outliving the pointer it refers to.
 */
export async function noteDecision(type: ConsentType, action: ConsentAction): Promise<void> {
  const handoff = await readRegistrationHandoff()

  if (handoff === null) {
    return
  }

  await rememberRegistration({
    patientId: handoff.patientId,
    guardianRequired: handoff.guardianRequired,
    decided: { ...handoff.decided, [type]: action },
  })
}

/**
 * Forget it.
 *
 * CALLED WHEN `data_processing` IS DECLINED, and only then. That registration is
 * `discarded` — deliberately abandoned, purged on schedule — and nobody should be left
 * holding a pointer to it, least of all on a shared handset.
 *
 * It is deliberately NOT called on agreement, which is the case worth explaining: the
 * telemedicine question is still open on the same screen, and clearing the pointer at the
 * moment the first consent succeeds would strand the patient one question short of finished
 * with no way back to it. It expires on its own half an hour later, which is the shortest
 * life that still lets somebody read a consent policy properly before answering it.
 */
export async function forgetRegistration(): Promise<void> {
  const jar = await cookies()

  jar.delete(COOKIE)
}
