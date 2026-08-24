/**
 * The public surface of @carevelo/realtime.
 *
 * Everything an application may touch is here, and the shape of this list is the design:
 * there is no `Echo`, no `channel(name: string)`, and no way to read a broadcast payload.
 * A screen names a channel through the client, says which events should make it re-fetch,
 * and re-fetches. That is the whole vocabulary.
 *
 * READ ./README.md BEFORE WIRING THE FIRST SCREEN — in particular the "hint, not payload"
 * rule, which is the one a well-meaning feature breaks first.
 *
 * @see docs/30-architecture/realtime-broadcasting.md
 */

export { createRealtimeClient } from './client'
export type { RealtimeClient, RealtimeConfig, RealtimeIdentity } from './client'

export { BROADCAST_AUTH_PATH, resolveSocketConfig } from './config'
export type { SocketConfig, SocketEnv } from './config'

export { EVENTS_ON } from './events'
export type { ChannelEvent, ChannelEvents, Hint, HintSubject, RealtimeEvent } from './events'

export type { ChannelKind, RealtimeChannel } from './channels'
export type { LiveOptions, LiveStatus, LiveSubscription, TransportState } from './live'
