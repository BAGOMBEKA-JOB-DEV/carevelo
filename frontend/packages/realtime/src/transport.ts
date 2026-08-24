/**
 * The only file in the workspace that touches Laravel Echo or pusher-js.
 *
 * frontend/README.md calls packages/realtime "the only place Laravel Echo is imported",
 * two lint rules enforce it (eslint.config.js `no-restricted-imports`, and
 * .dependency-cruiser.cjs `realtime-only-through-the-wrapper`), and inside the package
 * the boundary is narrowed once more to this file. Everything else here speaks in
 * channels and hints; only this module knows what a socket is.
 *
 * WHY EVERY IMPORT OF ECHO IS DYNAMIC. Two reasons, and both matter.
 *
 *   Server rendering. This package is imported by app code that Next renders on the
 *   server and prerenders at build time. pusher-js is a browser library: its `browser`
 *   entry is the one a bundler picks, and evaluating it where there is no `window` is
 *   not something to find out about during a production build. A static import would run
 *   at module load, before any guard could help. A dynamic one runs only after the
 *   `typeof window` check below, which means importing this package from a server
 *   component is inert rather than fatal.
 *
 *   Weight. Echo and pusher-js together are a meaningful share of the patient portal's
 *   budget, and the portal's budget exists because its users are on handsets and metered
 *   data (frontend-nextjs.md). Dynamic imports put them in their own chunk, fetched when
 *   a screen actually asks to go live and never on a page that does not.
 *
 * @see docs/30-architecture/realtime-broadcasting.md — connection lifecycle
 */

import type Echo from 'laravel-echo'
import type { ChannelAuthorizationHandler } from 'pusher-js'
import type { SocketConfig } from './config'

type ReverbEcho = Echo<'reverb'>

/** An Echo private channel. The only Echo type that leaves this module. */
export type ReverbPrivateChannel = ReturnType<ReverbEcho['private']>

/**
 * The socket's state, reduced to the three cases a screen can act on.
 *
 * Echo distinguishes `reconnecting` from `connecting` and `failed` from `disconnected`.
 * Neither distinction changes what anything downstream does — you are either receiving
 * frames or you are refreshing on a timer — and a four-state machine that behaves like a
 * three-state one is an invitation to handle a case that means nothing.
 */
export type SocketStatus = 'connecting' | 'connected' | 'disconnected'

export interface Transport {
  /** Whether a Reverb was configured at all. False means polling, permanently, today. */
  readonly configured: boolean

  /**
   * Subscribe to a private channel, or resolve null when there is no socket to be had.
   *
   * Ref-counted per channel name. Two screens can hold the same channel — a console with
   * the pharmacy queue open and a notification badge both want the user channel — and
   * without counting, the first one to unmount would unsubscribe the other. That failure
   * is invisible: the surviving screen simply stops updating and looks slow.
   */
  join(name: string): Promise<ReverbPrivateChannel | null>

  /** Release one hold on a channel. The subscription ends when the last one does. */
  leave(name: string): void

  /** Observe the connection. Returns the function that stops observing. */
  onStatusChange(listener: (status: SocketStatus) => void): () => void

  /** Close the socket for good. */
  close(): void
}

export function createTransport(config: SocketConfig | null): Transport {
  let connecting: Promise<ReverbEcho | null> | null = null
  let echo: ReverbEcho | null = null
  let closed = false

  /** How many live subscriptions hold each channel name. */
  const holds = new Map<string, number>()

  const instance = (): Promise<ReverbEcho | null> => {
    // The server-rendering guard, and the reason nothing above it is a static import.
    if (closed || config === null || typeof window === 'undefined') {
      return Promise.resolve(null)
    }

    connecting ??= connect(config).then((created) => {
      if (created !== null && closed) {
        // close() landed while the chunk was still downloading. Without this the socket
        // opens after the page has finished with it and stays open.
        created.disconnect()

        return null
      }

      echo = created

      return created
    })

    return connecting
  }

  return {
    get configured(): boolean {
      return config !== null
    },

    async join(name: string): Promise<ReverbPrivateChannel | null> {
      const live = await instance()

      if (live === null || closed) {
        return null
      }

      holds.set(name, (holds.get(name) ?? 0) + 1)

      // Echo caches the channel object per name, so two holders get the same one and can
      // each bind their own listeners to it. Subscription authorisation happens here, in
      // Echo, against /broadcasting/auth — see authorizerFor().
      return live.private(name)
    },

    leave(name: string): void {
      const remaining = (holds.get(name) ?? 0) - 1

      if (remaining > 0) {
        holds.set(name, remaining)

        return
      }

      holds.delete(name)

      // `leave`, not `leaveChannel`: Echo stores a private channel under `private-<name>`
      // and only `leave` knows to look for the prefixed variants.
      echo?.leave(name)
    },

    onStatusChange(listener: (status: SocketStatus) => void): () => void {
      let cancelled = false
      let unbind: (() => void) | null = null

      void instance().then((live) => {
        if (live === null || cancelled) {
          return
        }

        unbind = live.connector.onConnectionChange((status) => {
          switch (status) {
            case 'connected':
              listener('connected')
              break
            case 'connecting':
            case 'reconnecting':
              listener('connecting')
              break
            default:
              listener('disconnected')
          }
        })
      })

      return (): void => {
        cancelled = true
        unbind?.()
        unbind = null
      }
    },

    close(): void {
      closed = true
      holds.clear()
      echo?.disconnect()
      echo = null
      connecting = null
    },
  }
}

async function connect(config: SocketConfig): Promise<ReverbEcho | null> {
  try {
    const [echoModule, pusherModule] = await Promise.all([
      import('laravel-echo'),
      import('pusher-js'),
    ])

    const EchoConstructor = echoModule.default

    return new EchoConstructor<'reverb'>({
      broadcaster: 'reverb',
      key: config.key,
      wsHost: config.host,
      wsPort: config.port,
      wssPort: config.port,
      forceTLS: config.forceTLS,

      // Websockets only. The HTTP fallbacks pusher-js offers are for reaching Pusher's
      // hosted service through hostile middleboxes; Reverb is ours, in region, and a
      // long-poll fallback here would be a second transport to reason about for a
      // product that already degrades to plain polling on purpose.
      enabledTransports: ['ws', 'wss'],

      // Handed over explicitly rather than left on `window.Pusher`. Echo's fallback is a
      // global, and a global is one page-scope collision away from a socket that will not
      // start — with the CSP this product ships, it is also the kind of thing that works
      // in development and not in production.
      Pusher: pusherModule.default,

      // Echo otherwise monkey-patches axios, jQuery, Vue-resource and Turbo on the way
      // past to add an X-Socket-ID header. None of them exist here — @carevelo/api-client
      // owns every request this workspace makes — and patching globals from a shared
      // package is not a thing this codebase does.
      withoutInterceptors: true,

      channelAuthorization: { customHandler: authorizerFor(config) },
    })
  } catch (error) {
    // A chunk that will not load, a browser that refuses the module, a CSP that blocks
    // it. All the same answer: there is no socket, so poll. This must never throw into
    // the screen that asked to go live.
    warn('the broadcast transport could not start; falling back to polling', error)

    return null
  }
}

/**
 * Sign a subscription with the session cookie.
 *
 * Written out rather than left to Echo's built-in authorizer because three of its
 * details need to be ours and visible:
 *
 *   CREDENTIALS. `credentials: 'include'` is what carries the Sanctum session cookie to
 *   the API. Everything else about authentication follows from that one word — there is
 *   no bearer token, nothing in localStorage, and no second credential to leak.
 *
 *   NO CSRF TOKEN, AND THAT IS CORRECT. Laravel registers /broadcasting/auth with
 *   PreventRequestForgery explicitly removed (BroadcastManager::routes), so there is no
 *   token to find and nothing here goes looking for one — Echo's default authorizer
 *   hunts for a `meta[name="csrf-token"]` that this product does not render, because it
 *   serves no Blade.
 *
 *   FORM ENCODING. The endpoint reads `socket_id` and `channel_name` as request input,
 *   which is what pusher-js sends and therefore what the controller is written for.
 */
function authorizerFor(config: SocketConfig): ChannelAuthorizationHandler {
  return ({ socketId, channelName }, callback): void => {
    void fetch(config.authEndpoint, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json' },
      body: new URLSearchParams({ socket_id: socketId, channel_name: channelName }),
    })
      .then(async (response): Promise<void> => {
        if (!response.ok) {
          // The status and nothing else. A 403 here means the tenant prefix did not match
          // the session, or the policy said no — both of which the backend has already
          // audited properly, and neither of which this side should describe in a browser
          // console.
          callback(new Error(`broadcast authorisation refused (${response.status})`), null)

          return
        }

        const body = (await response.json()) as { auth?: unknown; channel_data?: unknown }

        if (typeof body.auth !== 'string') {
          callback(new Error('broadcast authorisation returned no signature'), null)

          return
        }

        callback(null, { auth: body.auth })
      })
      .catch((error: unknown) => {
        callback(error instanceof Error ? error : new Error('broadcast authorisation failed'), null)
      })
  }
}

function warn(message: string, detail?: unknown): void {
  console.warn(`[@carevelo/realtime] ${message}`, detail)
}
