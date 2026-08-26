'use client'

import dynamic from 'next/dynamic'
import type { StageCopy } from './LiveKitStage'

/**
 * ====================================================================================
 * THE LAZY BOUNDARY. THE ONLY REASON THIS FILE EXISTS IS 146 KiB.
 * ====================================================================================
 *
 * `LiveKitStage` imports a WebRTC SDK that gzips to about 146 KiB. Imported normally it
 * lands in the FIRST-LOAD JavaScript of every route whose module graph can reach it, and
 * "can reach it" is a wider set than "renders it" — which is the part that bit.
 *
 * WHAT ACTUALLY HAPPENED, because it is worth writing down rather than rediscovering.
 * `app/appointments/[appointment]/page.tsx` imports ONE function from this domain's barrel:
 * `consultationHref`, a pure string helper with no imports of its own. The barrel also
 * re-exports `ConsultationScreen`, which reaches `ConsultationRoom` → `MediaPane` →
 * `VideoStage` → the SDK. Next collects a route's client modules from the module GRAPH, so
 * a `'use client'` module reachable through a barrel is registered for that route whether or
 * not a single byte of it is rendered. The measurement was unambiguous: before this file,
 * `/appointments/[appointment]` — a page that shows one booking and a link — carried the
 * whole video SDK, and it went from about 140 KiB to 286.7 KiB.
 *
 * `next/dynamic` cuts the graph. The import below becomes an ASYNC chunk that no route's
 * first load includes, and the SDK is fetched when a room is actually ready to open one.
 *
 * ====================================================================================
 * AND THIS IS BETTER FOR THE ROOM ITSELF, NOT ONLY FOR THE OTHER ROUTE
 * ====================================================================================
 *
 * The binding constraint is a mid-range Android on variable mobile data. Loaded eagerly, the
 * consultation page could not become interactive until 146 KiB of WebRTC had arrived — and
 * everything else on that page is the part that works when the picture does not: the
 * clinician's status, the emergency guidance, and the chat panel, which is a real channel to
 * a real clinician and is what a patient uses while they wait.
 *
 * Split, the room paints and the messages work immediately, and the SDK arrives alongside.
 * Nothing is delayed by it that was not already waiting: the connection could not have been
 * opened before the code to open it existed.
 *
 * `ssr: false` BECAUSE THERE IS NOTHING TO SERVER-RENDER. The component's entire output
 * depends on a peer connection, a microphone permission and an autoplay policy — three
 * things that exist only in a browser. Rendering it on the server would produce markup that
 * is wrong the moment it hydrates, and it would put the SDK back into the server bundle for
 * no benefit.
 *
 * WHY THE BOUNDARY IS ITS OWN FILE. `ssr: false` is only permitted from a Client Component,
 * and `VideoStage` — which decides whether there is anything to open — is a Server Component
 * and must stay one: it reads the entry, translates the copy, and renders the honest notice
 * when there is no credential. So the directive lives here, on a module that imports one
 * type and one Next helper and NOTHING else. Everything expensive is behind the arrow
 * function below, which is the whole point.
 */

const LiveKitStage = dynamic(
  () => import('./LiveKitStage').then((module) => module.LiveKitStage),
  {
    ssr: false,

    /*
     * A SENTENCE, NOT A SPINNER, and it is the same rule the rest of this domain follows.
     * A grey rectangle with a spinner is the frozen frame the whole degradation design
     * exists to prevent: it says "wait" without saying for what or for how long, and a
     * patient on a bad connection reads it as the product having stopped.
     *
     * This one is true and it is brief. It is replaced by the real status line — which says
     * "Connecting…" and then "Connected" — the moment the SDK lands.
     */
    loading: () => <p className="media-status">{LOADING_SENTENCE}</p>,
  },
)

/**
 * The one sentence the boundary itself can say.
 *
 * A MODULE CONSTANT AND NOT A PROP, which is a compromise worth naming rather than hiding.
 * Every other sentence in this app is translated on the server and handed down as `copy`,
 * and `dynamic()` is evaluated once at module scope, before any component has props — so
 * there is nowhere for a translated string to come from at the moment this is constructed.
 *
 * The alternative was passing `copy` into a wrapper and rendering the loading state myself,
 * which means re-implementing `dynamic`'s loading contract to translate eight words that are
 * on screen for a few hundred milliseconds. When a second language lands this is one of a
 * small number of strings that will need moving; `messages/domains/Consultations.en.json`
 * carries `mediaOpening` with the same words so the catalogue already knows about it.
 */
const LOADING_SENTENCE = 'Opening the picture and sound…'

/**
 * Everything below is a pass-through. It exists so the module above can be `'use client'`
 * without `VideoStage` having to be.
 */
export function MediaClient({ url, token, copy }: { url: string; token: string; copy: StageCopy }) {
  return <LiveKitStage url={url} token={token} copy={copy} />
}
