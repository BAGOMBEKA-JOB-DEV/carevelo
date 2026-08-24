/**
 * The only way to name a broadcast channel from the browser.
 *
 * This is the mirror of backend/app/Broadcasting/TenantChannel.php, and it exists for
 * the same reason: every channel in Carevelo is private and tenant-prefixed, and an
 * unprefixed name is a cross-tenant leak that PUSHES another clinic's data to a
 * subscriber unprompted. Our tenants are frequently each other's local competitors, so
 * that is not a theoretical grade of defect.
 *
 * Three things make an unprefixed name impossible to build rather than merely
 * discouraged.
 *
 *  1. There is no exported `channel(name: string)`. Every constructor below is a named
 *     function that produces one shape of name and no other.
 *  2. Every segment is validated, exactly as the PHP is. An empty tenant would yield
 *     `tenant..pharmacy-queue`, which is structurally unprefixed and matched by nothing;
 *     a segment containing a dot lets a caller smuggle extra segments in and produce a
 *     name that authorises as one channel and delivers as another.
 *  3. RealtimeChannel carries a symbol this module does not export, so an object literal
 *     that merely LOOKS like one is a compile error rather than a subscription. Without
 *     that, `live({ channel: { kind: 'patient', name: 'tenant.other-clinic.patient.x' } })`
 *     would type-check, and the whole guarantee would rest on nobody trying.
 *
 * Note what is not here: a tenant argument on the public surface. The client takes the
 * tenant ONCE, from the session, at construction — see ./client.ts. A per-call tenant
 * would be a per-call opportunity to pass the wrong one.
 *
 * @see docs/30-architecture/realtime-broadcasting.md — the channel taxonomy
 * @see backend/app/Broadcasting/TenantChannel.php — the names these must match exactly
 * @see backend/routes/channels.php — what authorises them
 */

/*
 * The proof-of-construction mark. Not exported, so no code outside this module can
 * produce a value of type RealtimeChannel — the compiler refuses the literal, and there
 * is no cast that is not obviously a cast in review.
 */
const BUILT_HERE = Symbol('carevelo.realtime.channel')

/** Every channel this system has. There is deliberately no platform-wide one. */
export type ChannelKind =
  | 'pharmacy-queue'
  | 'dispatch-board'
  | 'user'
  | 'patient'
  | 'rider'
  | 'consultation'

/**
 * A channel that has been through the constructors below.
 *
 * `name` carries no `private-` prefix. The transport adds it on the way out and the
 * broadcaster strips it before matching, which is the same convention the PHP patterns
 * follow.
 */
export interface RealtimeChannel<K extends ChannelKind = ChannelKind> {
  readonly [BUILT_HERE]: true
  readonly kind: K
  readonly name: string
}

/** Order arrived, order state changed. Pharmacists and clinic administrators. */
export function pharmacyQueueChannel(tenantId: string): RealtimeChannel<'pharmacy-queue'> {
  return built('pharmacy-queue', `tenant.${segment(tenantId, 'clinic')}.pharmacy-queue`)
}

/** Delivery created, assigned, status changed. Dispatchers and clinic administrators. */
export function dispatchBoardChannel(tenantId: string): RealtimeChannel<'dispatch-board'> {
  return built('dispatch-board', `tenant.${segment(tenantId, 'clinic')}.dispatch-board`)
}

/** One staff member's own notifications. Nobody else joins it, including their admin. */
export function userChannel(tenantId: string, userId: string): RealtimeChannel<'user'> {
  return built('user', `tenant.${segment(tenantId, 'clinic')}.user.${segment(userId, 'user')}`)
}

/** One patient's own appointment, payment, order and delivery state. */
export function patientChannel(tenantId: string, patientId: string): RealtimeChannel<'patient'> {
  return built(
    'patient',
    `tenant.${segment(tenantId, 'clinic')}.patient.${segment(patientId, 'patient')}`,
  )
}

/**
 * One rider's own assignments, and nothing else in the system.
 *
 * The most restricted channel there is. A rider is the least-trusted human actor and
 * needs the least data, so their entire realtime surface is exactly one channel wide.
 */
export function riderChannel(tenantId: string, riderId: string): RealtimeChannel<'rider'> {
  return built('rider', `tenant.${segment(tenantId, 'clinic')}.rider.${segment(riderId, 'rider')}`)
}

/**
 * Consultation SESSION state — started, mode degraded, ended.
 *
 * NEVER consultation media. Video and voice are a separate concern with a separate
 * provider decision, and Reverb carries none of it.
 */
export function consultationChannel(
  tenantId: string,
  consultationId: string,
): RealtimeChannel<'consultation'> {
  return built(
    'consultation',
    `tenant.${segment(tenantId, 'clinic')}.consultation.${segment(consultationId, 'consultation')}`,
  )
}

function built<K extends ChannelKind>(kind: K, name: string): RealtimeChannel<K> {
  return { [BUILT_HERE]: true, kind, name }
}

/**
 * Validate one dot-separated segment, refusing loudly at construction.
 *
 * The same two refusals as TenantChannel::segment() in the backend, for the same two
 * reasons. Kept identical on purpose: a client that can build a name the server would
 * reject produces a subscription failure nobody can explain from either side.
 */
function segment(value: string, label: string): string {
  if (value === '' || value.includes('.')) {
    throw new Error(
      `A broadcast channel needs a non-empty, dot-free ${label} identifier. `
      + 'Every channel is tenant-prefixed and there is no unprefixed form.',
    )
  }

  return value
}
