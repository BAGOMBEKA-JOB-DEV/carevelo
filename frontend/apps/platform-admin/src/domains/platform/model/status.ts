import type { BadgeTone, IconName } from '@carevelo/ui'
import type { TenantStatus } from './types'

/**
 * How each state of the tenant lifecycle reads on screen.
 *
 * THE COLOUR IS NEVER THE ONLY SIGNAL. Every badge carries the word as well, because a
 * coloured pill says nothing to a colour-blind operator and less to a screen reader. The
 * tone is a second opinion on a fact the text already states.
 *
 * `suspended` IS AMBER AND NOT RED, DELIBERATELY. Red is this system's colour for a
 * forbidden or failed state, and a suspension is neither: it is a commercial decision that
 * blocks staff sign-in, and it leaves the clinic's patients reading their own records, a
 * delivery in flight completing, and the controller-obligation export reachable. Painting
 * it as a failure invites an operator to treat a billing dispute as an incident, which is
 * the exact confusion `UpdateTenantRequest` exists to prevent.
 *
 * `closed` IS NEUTRAL for the same reason `completed` is on an appointment: it is an
 * ending, not a problem somebody should try to fix from this screen.
 *
 * @see docs/20-domain/state-machines.md
 */

export const STATUS_TONE: Record<TenantStatus, BadgeTone> = {
  provisioning: 'info',
  active: 'good',
  suspended: 'warn',
  offboarding: 'warn',
  closed: 'neutral',
}

export const STATUS_ICON: Partial<Record<TenantStatus, IconName>> = {
  provisioning: 'clock',
  active: 'check',
  suspended: 'lock',
  offboarding: 'box',
}

/**
 * What each state MEANS, in the sentence an operator needs before acting.
 *
 * These are not decoration. Every one of them is a thing somebody has got wrong at least
 * once in this product's documents: that suspension is clinical (it is not), that
 * provisioning is a switch somebody flips (it is a checklist the clinic completes), that
 * offboarding withholds the export (it never does).
 */
export const STATUS_MEANING: Record<TenantStatus, string> = {
  provisioning:
    'Created, and not yet open. The clinic becomes active by completing its own checklist '
    + '— branding, at least one bookable service, at least one clinician, consent text, its '
    + 'own mobile-money account. None of that is a switch on this screen.',
  active: 'Open. Staff can sign in and patients can book.',
  suspended:
    'Staff sign-in is blocked. Patients still read their own records, a delivery already in '
    + 'flight still completes, and the data export stays reachable. A commercial dispute '
    + 'must not become a clinical incident.',
  offboarding:
    'Leaving. The export is deliberately reachable throughout — the clinic is the data '
    + 'controller and leaves with its data regardless of any commercial dispute.',
  closed: 'Finished. Retention and deletion are governed by the retention policy, not from here.',
}

const KNOWN = new Set<string>(Object.keys(STATUS_TONE))

/**
 * Narrow the resource's `status`, which the contract types as a plain string.
 *
 * `PlatformTenantResource.status` is `string` while `TenantStatus` is the enum, and the two
 * are the same value described twice by the generator. A state this build has never heard
 * of renders with a neutral tone and its raw name rather than crashing or, worse, being
 * silently dropped: an operator looking at a clinic whose status vanished has been told
 * nothing at all.
 */
export function knownStatus(status: string): TenantStatus | null {
  return KNOWN.has(status) ? (status as TenantStatus) : null
}

/** Every state, in lifecycle order, for a control that offers a transition. */
export const STATUSES: readonly TenantStatus[] = [
  'provisioning',
  'active',
  'suspended',
  'offboarding',
  'closed',
]
