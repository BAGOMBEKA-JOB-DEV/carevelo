'use client'

import dynamic from 'next/dynamic'

/**
 * ====================================================================================
 * THE LAZY BOUNDARY. THE ONLY REASON THIS FILE EXISTS IS 146 KiB.
 * ====================================================================================
 *
 * `LiveKitStage` imports a WebRTC SDK that gzips to about 146 KiB. Imported normally it lands
 * in the FIRST-LOAD JavaScript of every route whose module graph can reach it, and "can reach
 * it" is a wider set than "renders it" — which is the part that bit, in the patient portal,
 * where the identical file carries the identical note.
 *
 * Next collects a route's client modules from the module GRAPH, so a `'use client'` module
 * reachable through a domain barrel is registered for that route whether or not a single byte
 * of it is rendered. In the portal that put the whole video SDK onto a page which shows one
 * booking and a link. This console's barrel is bigger than the portal's and is imported by
 * more routes, so the same mechanism applies with more places to land.
 *
 * `next/dynamic` cuts the graph. The import below becomes an ASYNC chunk that no route's
 * first load includes, and the SDK is fetched when a room is actually ready to open one.
 *
 * ====================================================================================
 * AND THIS IS BETTER FOR THE ROOM ITSELF, NOT ONLY FOR THE OTHER ROUTES
 * ====================================================================================
 *
 * Ronald works between rooms on a phone. The consultation room is the longest screen in the
 * product — the note editor, the patient's history, the prescribing form, the chat panel —
 * and every one of those is the part that still works when the picture does not. Loaded
 * eagerly, none of them could become interactive until 146 KiB of WebRTC had arrived.
 *
 * Split, the screen paints and the note editor accepts typing immediately, and the SDK
 * arrives alongside. Nothing is delayed that was not already waiting: the connection could
 * not have been opened before the code to open it existed.
 *
 * `ssr: false` BECAUSE THERE IS NOTHING TO SERVER-RENDER. The component's entire output
 * depends on a peer connection, a microphone permission and an autoplay policy — three things
 * that exist only in a browser. Rendering it on the server would produce markup that is wrong
 * the moment it hydrates, and would put the SDK into the server bundle for no benefit.
 *
 * WHY THE BOUNDARY IS ITS OWN FILE. `ssr: false` is only permitted from a Client Component,
 * and `VideoStage` — which decides whether there is anything to open — is a Server Component
 * and must stay one. So the directive lives here, on a module that imports one Next helper
 * and NOTHING else. Everything expensive is behind the arrow function below.
 */

const LiveKitStage = dynamic(
  () => import('./LiveKitStage').then((module) => module.LiveKitStage),
  {
    ssr: false,

    /*
     * A SENTENCE, NOT A SPINNER, and it is the same rule the rest of this domain follows. A
     * grey rectangle with a spinner is the frozen frame the whole degradation design exists
     * to prevent: it says "wait" without saying for what, and a clinician reads it as the
     * console having stopped — on the screen where they decide whether to abandon.
     *
     * This one is true and it is brief. It is replaced by the real status line — "Connecting…"
     * and then "Connected" — the moment the SDK lands.
     */
    loading: () => <p className="media-status">Opening the picture and sound…</p>,
  },
)

/**
 * A pass-through. It exists so the module above can be `'use client'` without `VideoStage`
 * having to be.
 */
export function MediaClient({ url, token }: { url: string; token: string }) {
  return <LiveKitStage url={url} token={token} />
}
