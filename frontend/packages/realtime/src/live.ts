/**
 * Keep a view fresh. Over a socket when there is one, on a timer when there is not.
 *
 * THE POLLING FALLBACK IS PART OF THE PUBLIC SURFACE, not something each screen
 * reinvents. That is deliberate. "Reverb being unavailable degrades to polling and never
 * blocks a clinical or dispensing action" is an acceptance criterion, and an acceptance
 * criterion implemented six times in six screens is met in three of them. Here there is
 * one implementation, it is on by default, and a screen would have to work at it to be
 * blocked — the socket is an optimisation layered onto a timer that was already running.
 *
 * Read that once more, because it inverts the usual mental model: this is not a websocket
 * with a fallback. It is a periodic refresh that goes quiet while a socket is delivering.
 * With BROADCAST_CONNECTION=log on the backend today, the timer is the ENTIRE mechanism —
 * and every screen built on this package still works, which is the point.
 *
 * @see docs/30-architecture/realtime-broadcasting.md — connection lifecycle, scaling and
 *      failure
 */

import type { ChannelKind, RealtimeChannel } from './channels'
import { hintFrom, type ChannelEvent, type Hint } from './events'
import type { ReverbPrivateChannel, Transport } from './transport'

/**
 * What a screen can tell the person looking at it.
 *
 * Worth surfacing rather than hiding: a pharmacist who knows the queue is on a 15-second
 * refresh behaves differently from one who believes it is instant, and a board that has
 * quietly stopped updating is the failure this whole design is written against.
 */
export type TransportState = 'connecting' | 'live' | 'polling'

export interface LiveStatus {
  readonly transport: TransportState
  /** When `refresh` last ran to completion. Null until the first one has. */
  readonly lastRefreshAt: Date | null
}

export interface LiveOptions<K extends ChannelKind> {
  /** Built by the client. There is no way to name a channel by hand — see ./channels.ts. */
  readonly channel: RealtimeChannel<K>

  /**
   * Which of this channel's events should trigger a refresh.
   *
   * Typed to the channel, so listening for something that channel never carries does not
   * compile. `EVENTS_ON[kind]` is the everything-on-this-channel shorthand.
   */
  readonly on: readonly ChannelEvent<K>[]

  /**
   * Go and ask the API what is true now.
   *
   * Called with a Hint when one record changed, and with `null` when the whole view
   * should reconcile — on a poll tick, and after a reconnect during which frames were
   * missed. A screen that ignores the argument and always re-fetches everything is
   * CORRECT, merely heavier; a screen that renders the hint instead of fetching is
   * neither. See ./events.ts.
   *
   * Return a promise if the refresh is asynchronous and this will not start another until
   * it settles. A rejection is swallowed: a failed refresh must not stop the next one,
   * because the next one is how the view recovers.
   */
  readonly refresh: (hint: Hint | null) => void | Promise<void>

  /** How often to reconcile while there is no socket. Default 15s. */
  readonly pollEveryMs?: number | undefined

  /**
   * How often to reconcile anyway WHILE the socket is live. Default 5 minutes.
   *
   * A missed frame is self-healing because any subsequent refresh reconciles it — but on
   * a quiet channel there is no subsequent refresh, so a frame dropped at 09:00 leaves a
   * board wrong until somebody reloads. This is the floor under that. Pass 0 to disable.
   */
  readonly reconcileEveryMs?: number | undefined

  /**
   * Refresh once immediately on start. Default false.
   *
   * False because a screen normally mounts having just rendered from a server-side fetch,
   * and an immediate second fetch would be a duplicate request on every mount of every
   * live screen, for data a few hundred milliseconds old. Pass true where the view came
   * from something older — a restored tab, a cached shell.
   *
   * This concerns only the FIRST subscribe. Every reconnect after a gap reconciles
   * unconditionally, because that gap is exactly where a frame went missing.
   */
  readonly refreshOnStart?: boolean | undefined

  /** Called whenever the status changes, for a "live" / "refreshing" indicator. */
  readonly onStatus?: ((status: LiveStatus) => void) | undefined
}

export interface LiveSubscription {
  status(): LiveStatus
  /** Reconcile now — after a write of your own, or when a person presses refresh. */
  refreshNow(): void
  stop(): void
}

const DEFAULT_POLL_MS = 15_000
const DEFAULT_RECONCILE_MS = 300_000

/**
 * How many times a refused subscription is retried before the screen simply stays on the
 * timer.
 *
 * Deliberately NOT branching on the HTTP status. A 403 (role changed, account
 * deactivated, tenant prefix mismatch) and a 500 (Reverb restarted mid-handshake) get the
 * same treatment, because this layer is the authority on neither: if the person has
 * genuinely lost access, the very next re-fetch through @carevelo/api-client says so with
 * a problem document the screen already knows how to render. Deciding it here would mean
 * two places deciding what a permission is, which is the drift that "channel
 * authorisation runs the same policies as the REST API" exists to prevent.
 */
const MAX_SUBSCRIBE_ATTEMPTS = 3
const RETRY_BASE_MS = 5_000

/** A subscription on a server: no view to keep fresh, and no timer to leak. */
const INERT: LiveSubscription = {
  status: () => ({ transport: 'polling', lastRefreshAt: null }),
  refreshNow: () => {},
  stop: () => {},
}

export function startLive<K extends ChannelKind>(
  transport: Transport,
  options: LiveOptions<K>,
): LiveSubscription {
  /*
   * Server rendering. A timer started during a server render outlives the response and
   * refreshes nothing, and there is no `document` to hang a visibility listener on.
   * Returning an inert handle rather than throwing lets a component call this
   * unconditionally and leave the decision to its effect, which is what a React component
   * will do.
   */
  if (typeof window === 'undefined') {
    return INERT
  }

  const pollEveryMs = options.pollEveryMs ?? DEFAULT_POLL_MS
  const reconcileEveryMs = options.reconcileEveryMs ?? DEFAULT_RECONCILE_MS

  let stopped = false
  let transportState: TransportState = transport.configured ? 'connecting' : 'polling'
  let lastRefreshAt: Date | null = null
  let timer: number | undefined
  let inFlight = false
  let queued: Hint | null | undefined
  let attempts = 0
  let everSubscribed = false
  let subscribing = false
  let channel: ReverbPrivateChannel | null = null

  /**
   * Which subscription generation is current.
   *
   * Echo caches one channel object per name, so a channel another screen still holds
   * survives our detach — and its `subscribed`/`error` callbacks cannot be unbound
   * individually the way `listen` handlers can. Both of those leave stale callbacks
   * pointed at this closure. Stamping each attachment with the generation it belongs to
   * makes a stale callback recognise itself and return, and it closes the matching race
   * on the other side: a socket that drops while `join` is still in flight.
   */
  let generation = 0

  /** Our own event handlers, kept by reference so they can be unbound one at a time. */
  const handlers = new Map<string, (payload: unknown) => void>()

  const publish = (): void => {
    options.onStatus?.({ transport: transportState, lastRefreshAt })
  }

  const setState = (next: TransportState): void => {
    if (stopped || next === transportState) {
      return
    }

    transportState = next
    // The interval depends on the state, so a state change reschedules.
    schedule()
    publish()
  }

  /**
   * Ask for a refresh, at most one at a time.
   *
   * Requests arriving while one is running collapse into a single full reconcile. That is
   * never wrong, only heavier: a reconcile subsumes any hint it replaces, and a pharmacy
   * queue taking three frames in a second wants one refresh rather than three.
   */
  const request = (hint: Hint | null): void => {
    if (stopped) {
      return
    }

    if (inFlight) {
      queued = queued === undefined ? hint : null

      return
    }

    inFlight = true

    void Promise.resolve()
      .then(() => options.refresh(hint))
      .catch((error: unknown) => {
        // Swallowed on purpose. The API being briefly unreachable must not stop the
        // timer, because the timer is how the view comes back.
        warn('a refresh failed; the next one will reconcile', error)
      })
      .then(() => {
        inFlight = false
        lastRefreshAt = new Date()
        publish()

        const next = queued
        queued = undefined

        if (next !== undefined && !stopped) {
          request(next)
        }
      })
  }

  const clearTimer = (): void => {
    if (timer !== undefined) {
      window.clearTimeout(timer)
      timer = undefined
    }
  }

  const schedule = (): void => {
    clearTimer()

    if (stopped) {
      return
    }

    /*
     * A hidden tab is a tab nobody is watching. Polling it spends a rider's battery and a
     * patient's data bundle refreshing a screen that is not on — and these users are on
     * handsets and metered connections, which is the same reason the portal has a weight
     * budget at all. The visibility listener below restarts the clock, with an immediate
     * reconcile, the moment they come back.
     */
    if (document.visibilityState === 'hidden') {
      return
    }

    const interval = transportState === 'live' ? reconcileEveryMs : pollEveryMs

    if (interval <= 0) {
      return
    }

    timer = window.setTimeout(() => {
      request(null)
      schedule()
    }, interval)
  }

  const onVisibilityChange = (): void => {
    if (stopped) {
      return
    }

    if (document.visibilityState === 'hidden') {
      clearTimer()

      return
    }

    // Whatever happened while the tab was in the background, the answer is the same one.
    request(null)
    schedule()
  }

  /**
   * Give up the current subscription.
   *
   * The generation moves FIRST and unconditionally, so a `join` still in flight — and any
   * callback bound by the attachment being abandoned — knows it is stale even though
   * there is no channel object yet to null out.
   */
  const detach = (): void => {
    generation += 1

    if (channel === null) {
      return
    }

    // Unbound by reference: the channel object may be shared with another screen, and
    // tearing it down wholesale would leave that screen subscribed to a channel nothing
    // listens on — silent, and indistinguishable from a slow board.
    for (const [wireName, handler] of handlers) {
      channel.stopListening(wireName, handler)
    }

    handlers.clear()
    channel = null
    transport.leave(options.channel.name)
  }

  const attach = (bound: ReverbPrivateChannel): void => {
    const mine = generation

    channel = bound

    bound.subscribed(() => {
      if (stopped || generation !== mine) {
        return
      }

      attempts = 0
      setState('live')

      /*
       * RULE 4, the reconnect half. A prior subscription is never assumed to have
       * survived — permissions may have changed while the socket was down, and the
       * subscribe that just succeeded re-ran /broadcasting/auth to find out.
       *
       * Nothing to reconcile on the FIRST subscribe, though: the screen rendered from an
       * authorised fetch moments ago, and refreshing here would add a duplicate request
       * to every mount of every live screen in the product. Every subscribe after that
       * one follows a gap in which frames were missed, so it reconciles.
       */
      if (everSubscribed) {
        request(null)
      }

      everSubscribed = true
      schedule()
    })

    bound.error((reason: unknown) => {
      if (stopped || generation !== mine) {
        return
      }

      // The channel KIND, never the channel NAME: the name carries a patient or user
      // identifier, and a browser console is a disclosure surface like any other.
      warn(`subscription refused on the ${options.channel.kind} channel`, reason)

      detach()
      setState('polling')

      if (attempts < MAX_SUBSCRIBE_ATTEMPTS) {
        window.setTimeout(() => {
          void subscribe()
        }, RETRY_BASE_MS * attempts)
      }
    })

    for (const event of options.on) {
      // The leading dot tells Echo this is a broadcastAs() name rather than a PHP class
      // in the App\Events namespace it would otherwise prepend.
      const wireName = `.${event}`
      const handler = (payload: unknown): void => {
        request(hintFrom(event, payload))
      }

      handlers.set(wireName, handler)
      bound.listen(wireName, handler)
    }
  }

  const subscribe = async (): Promise<void> => {
    // `subscribing` matters: Echo reports a single transition through more than one
    // connection event, so two "connected" notifications for one reconnect are normal.
    // Without this the second would start a parallel join while the first is still
    // awaiting, and the channel would end up held twice with two sets of listeners.
    if (stopped || subscribing || channel !== null) {
      return
    }

    subscribing = true
    attempts += 1

    const mine = generation

    try {
      const bound = await transport.join(options.channel.name)

      if (bound === null) {
        // No socket, now or for the rest of this session. The timer already has the
        // screen covered, which is the whole reason this is not an error.
        setState('polling')

        return
      }

      if (stopped || generation !== mine) {
        // Stopped, or the socket dropped while the chunk was still loading. Give the hold
        // straight back rather than attaching to a subscription nobody will re-authorise.
        transport.leave(options.channel.name)

        return
      }

      attach(bound)
    } finally {
      subscribing = false
    }
  }

  const stopWatchingConnection = transport.onStatusChange((status) => {
    if (stopped) {
      return
    }

    switch (status) {
      case 'connected':
        void subscribe()
        break

      case 'connecting':
        // Reconnecting counts as gone. Dropping the subscription here is what makes the
        // "connected" branch above a genuine re-authorisation rather than a resumption:
        // permissions may have changed while the socket was down, and only
        // /broadcasting/auth can say.
        detach()
        setState('connecting')
        break

      default:
        detach()
        setState('polling')
    }
  })

  document.addEventListener('visibilitychange', onVisibilityChange)

  void subscribe()

  if (options.refreshOnStart ?? false) {
    request(null)
  }

  schedule()

  return {
    status: (): LiveStatus => ({ transport: transportState, lastRefreshAt }),

    refreshNow: (): void => {
      request(null)
    },

    stop: (): void => {
      if (stopped) {
        return
      }

      stopped = true
      clearTimer()
      document.removeEventListener('visibilitychange', onVisibilityChange)
      stopWatchingConnection()
      detach()
    },
  }
}

function warn(message: string, detail?: unknown): void {
  console.warn(`[@carevelo/realtime] ${message}`, detail)
}
