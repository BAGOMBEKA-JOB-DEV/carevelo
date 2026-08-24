/**
 * The realtime client: one per app, holding one socket and the session it belongs to.
 *
 * WHY IDENTITY IS TAKEN ONCE, HERE. The tenant has to appear in every channel name —
 * that is what makes a channel tenant-prefixed — so unlike @carevelo/api-client, which
 * has no tenantId parameter anywhere and must never grow one, this package cannot avoid
 * holding it. What it can do is hold it in exactly one place.
 *
 * So identity arrives at construction, from what the API said about the current session,
 * and the channel helpers below take no tenant at all. A screen cannot pass the wrong
 * tenant because a screen never passes one; `ownPatient()` and `ownUser()` take no
 * argument because there is no other patient and no other user they could mean. The one
 * helper that takes an identifier is `consultation()`, because a clinician has many —
 * and the backend still refuses any consultation their policy does not cover.
 *
 * None of that is the security boundary. The boundary is
 * backend/app/Broadcasting/TenantPrefixedChannel.php, which compares the channel's tenant
 * against the SESSION's tenant, audits the mismatch, and then runs the same policy the
 * REST endpoint runs. This client's job is to make it impossible to ask the wrong
 * question by accident, not to be trusted with the answer.
 *
 * @see docs/30-architecture/realtime-broadcasting.md
 */

import {
  consultationChannel,
  dispatchBoardChannel,
  patientChannel,
  pharmacyQueueChannel,
  riderChannel,
  userChannel,
  type ChannelKind,
  type RealtimeChannel,
} from './channels'
import type { SocketConfig } from './config'
import { startLive, type LiveOptions, type LiveSubscription } from './live'
import { createTransport, type Transport } from './transport'

/**
 * Who this browser is, as the API reported it.
 *
 * Take these from GET /v1/me and its tenant bootstrap, never from a URL, a form field or
 * anything else the person on the other side controls. A tenant read from client input
 * is the shape of a cross-tenant read attempt — the backend refuses it and writes an
 * audit row, which is a bad way to find out that a page passed the wrong value.
 */
export interface RealtimeIdentity {
  readonly tenantId: string
  /** The signed-in user. Absent for nobody: an unauthenticated page has no realtime. */
  readonly userId: string
  /** The patient record this session belongs to, on the patient portal. */
  readonly patientId?: string | undefined
}

export interface RealtimeConfig {
  readonly identity: RealtimeIdentity
  /**
   * Reverb, or null for "there is no socket".
   *
   * null is a supported, ordinary configuration and the one in force today: every screen
   * falls back to polling and none of them blocks. See ./config.ts.
   */
  readonly socket: SocketConfig | null
}

export interface RealtimeClient {
  /** Order arrived, order state changed. Pharmacists and clinic administrators. */
  pharmacyQueue(): RealtimeChannel<'pharmacy-queue'>

  /** Delivery created, assigned, status changed. Dispatchers and clinic administrators. */
  dispatchBoard(): RealtimeChannel<'dispatch-board'>

  /** This user's own notifications. Not a colleague's, and not their administrator's. */
  ownUser(): RealtimeChannel<'user'>

  /** This patient's own appointment, payment, order and delivery state. */
  ownPatient(): RealtimeChannel<'patient'>

  /** This rider's own assignments, which is their entire realtime surface. */
  ownRider(): RealtimeChannel<'rider'>

  /** One consultation's SESSION state. Never its media — Reverb carries none. */
  consultation(consultationId: string): RealtimeChannel<'consultation'>

  /**
   * Keep a view fresh: subscribe if there is a socket, poll either way.
   *
   * Returns a handle whose `stop()` an effect must call on unmount. Calling this on the
   * server is safe and inert.
   */
  live<K extends ChannelKind>(options: LiveOptions<K>): LiveSubscription

  /** Close the socket. Call when the session ends — signing out, above all. */
  close(): void
}

export function createRealtimeClient(config: RealtimeConfig): RealtimeClient {
  const { tenantId, userId } = config.identity
  const transport: Transport = createTransport(config.socket)

  return {
    pharmacyQueue: () => pharmacyQueueChannel(tenantId),
    dispatchBoard: () => dispatchBoardChannel(tenantId),
    ownUser: () => userChannel(tenantId, userId),

    ownPatient: () => {
      const patientId = config.identity.patientId

      if (patientId === undefined || patientId === '') {
        // Staff sessions have no patient record, and the staff surfaces have no reason to
        // want one. Refusing loudly beats inventing an identifier: an empty segment would
        // build `tenant.<id>.patient.`, which authorises as nothing and would look, from
        // the screen, like a socket that never connects.
        throw new Error(
          'This session has no patient record, so it has no patient channel. '
          + 'Only a patient portal session subscribes to one.',
        )
      }

      return patientChannel(tenantId, patientId)
    },

    // The rider's channel is keyed by their USER id — riders are staff of the clinic, not
    // a separate kind of record. backend/app/Broadcasting/RiderChannel.php compares it to
    // $user->id and additionally requires the rider role, so a non-rider asking for their
    // own rider channel is refused rather than quietly given an empty one.
    ownRider: () => riderChannel(tenantId, userId),

    consultation: (consultationId: string) => consultationChannel(tenantId, consultationId),

    live: <K extends ChannelKind>(options: LiveOptions<K>): LiveSubscription =>
      startLive(transport, options),

    close: () => {
      transport.close()
    },
  }
}
