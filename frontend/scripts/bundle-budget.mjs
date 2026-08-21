/**
 * Fails the build when the patient portal ships more first-load JavaScript than its budget.
 *
 * docs/30-architecture/frontend-nextjs.md:112 states the budget: "Initial JavaScript under
 * 150KB gzipped for the booking path." Seven comments in this tree spend that number to
 * justify a decision — the icon set is a server component, the brand mark skips next/image,
 * there are no web fonts on the critical path, production source maps are off. Every one of
 * those comments was arguing against a budget that nothing measured, and in the meantime the
 * landing page had drifted well past it with no signal anywhere.
 *
 * eslint.config.js in this workspace makes the case already: "A rule that cannot fire is worse
 * than no rule — it manufactures exactly the confidence this project keeps having to take
 * apart." A documented budget that nothing measures is the same shape of problem. This is the
 * measurement.
 *
 * Run it AFTER `next build`; it reads that build's output and never triggers one.
 *
 *
 * WHERE THE NUMBER COMES FROM, AND WHY IT IS NOT NEXT'S OWN
 *
 * The natural source would be the "First Load JS" column that `next build` prints. Next 16.3.1
 * builds this app with Turbopack, and that build prints a bare route list with no size column
 * at all — checked by running it, not assumed. So there is no number to scrape and it has to
 * be computed from what the build wrote to disk.
 *
 * The next candidate, .next/build-manifest.json, does not carry it either. Under Turbopack its
 * `pages` map holds only `/_app: []` and `rootMainFilesTree` is `{}`: it describes the shared
 * root bundle and nothing per-route. There is no app-build-manifest.json in this version at all.
 *
 * What does carry per-route data is written per route, under .next/server/app/<entry>/ :
 *
 *   <entry>/build-manifest.json           polyfillFiles + rootMainFiles — the Turbopack runtime,
 *                                         React, the router, and the root layout's client half.
 *                                         Identical for every route, which is the point: it is
 *                                         the shared floor every route pays.
 *
 *   <entry>_client-reference-manifest.js  entryJSFiles — the chunks for THIS route's own client
 *                                         components. This is the part that actually varies:
 *                                         /sign-in pulls the sign-in form's chunk, / does not.
 *
 * The union of those two is exactly the set of <script src> tags Next emits for the route. That
 * equality is verified rather than assumed: .next/server/app/_global-error.html is the one route
 * this build prerenders to disk, it carries seven script tags, and the union of its two manifests
 * is the same seven files. Should a future Next change how it assembles that list, this script
 * and the browser would disagree in silence — so re-run that comparison on any Next upgrade.
 *
 * entryJSFiles and clientModules are unioned together rather than trusting one. They agree on
 * every route in this build; if a Next upgrade makes one of them incomplete, taking both means
 * the gate over-reports rather than under-reports, and a budget that fails loudly is recoverable
 * in a way that one quietly measuring half the bundle is not.
 *
 *
 * WHY GZIP, PER FILE
 *
 * The budget is written in gzipped bytes because that is what crosses the network, and on the
 * connection this product is designed for that is the number that costs a patient time. Each
 * chunk is gzipped separately, because the browser fetches each as its own response and a
 * server compresses each one on its own. Gzipping the concatenation would report a smaller,
 * fictional number — the chunks would share a dictionary they never share in production.
 *
 * zlib's default level, for the same reason: it is what a web server is configured to do.
 * Level 9 is within a rounding error here anyway, and level 1 is 20KB worse.
 *
 * CSS is not counted. The budget names JavaScript, and stylesheets do not block the main
 * thread the way a parse-and-execute does. That is a deliberate scope, not an oversight.
 *
 *
 * WHY THE GATE MEASURES THE MODULE-CAPABLE FIGURE
 *
 * Next emits its core-js bundle as <script nomodule>, so any browser that understands ES
 * modules skips it — roughly 38KB gzipped that no current browser ever downloads. The gate
 * originally counted it, on the reasoning that a ceiling should be defended against the worse
 * of the two paths.
 *
 * It is not counted now, and the reason is that it made the gate measure a browser this product
 * does not have. The budget exists for a patient on a mid-range Android on variable mobile
 * data; that phone runs a modern Chrome and fetches the module build. Counting bytes it never
 * requests inflated the figure by 38KB and put the documented 150KB target permanently out of
 * reach — which is how a budget stops being a target and becomes a ratchet that only ever moves
 * up. Turbopack emits polyfillFiles unconditionally, so this cannot be configured away either;
 * a browserslist targeting only modern engines changes nothing.
 *
 * Both numbers are printed on every run. The legacy total stays visible so that the day it
 * matters — a market where those browsers are real — the figure is already there.
 *
 * @see docs/30-architecture/frontend-nextjs.md — the budget
 * @see docs/00-overview/personas-and-actors.md — the mid-range Android phone it is defended for
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { gzipSync } from 'node:zlib'

const here = import.meta.dirname
const dist = resolve(here, '../apps/patient-portal/.next')

/*
 * TODO(perf): THE REAL TARGET IS 150 KiB. THIS GATE IS NOT SET THERE YET.
 *
 * docs/30-architecture/frontend-nextjs.md:112 — "Initial JavaScript under 150KB gzipped for
 * the booking path." The ceilings below are the sizes this bundle is at TODAY, roughly 25KiB
 * above that, and they are deliberately set there rather than at the target.
 *
 * Landing the gate at 150 KiB would have shipped a gate that is red on the first run, and a
 * gate that is red on arrival is a gate somebody comments out the week a release is due —
 * which would leave this budget measured by nothing all over again, the exact failure this
 * file exists to end. Set at today's number it is a ratchet instead: it cannot get worse
 * without someone deciding to make it worse in a diff a reviewer can see.
 *
 * The gap is not hidden to make that palatable. Every run prints the distance to 150 KiB, so
 * it shows up in the build log of every CI run until it reaches zero. Each time real weight
 * comes off the bundle, lower these numbers in the same commit — that is what turns the
 * ratchet. Delete this TODO when they read 153600 and the run is green.
 */
const TARGET_BYTES = 150 * 1024

/*
 * The routes that fail the build, and their current sizes in gzipped bytes.
 *
 * Only "/" is enforced. It is the landing page and the entry to the booking path the budget
 * names, and it is the one a patient arrives on cold with nothing warm in cache. Every other
 * route is measured and printed but not gated: a number in the log is enough to make a
 * regression visible in a build-log diff, and gating routes nobody has tuned yet would be
 * inventing budgets the architecture docs never set.
 *
 * As the booking flow lands its own routes, add them here with their measured size.
 *
 * 180_224 is 176 KiB: today's measurement of 179,789 bytes rounded up to the next whole KiB.
 * Two consecutive builds of an unchanged tree produced byte-identical output, so the 435 bytes
 * of slack are not there to absorb build noise — they are there so that the first person to
 * touch this is not fighting a gate that trips on a chunk-hash length. It is under a quarter of
 * a percent; nothing meaningful fits in it.
 */
const CEILINGS = {
  /*
   * THE DOCUMENTED NUMBER, not a ratchet above today's.
   *
   * 150KB gzipped for the booking path — docs/30-architecture/frontend-nextjs.md:112. Measured
   * as the bytes a module-capable browser actually downloads, which is every browser this
   * product targets. The portal sits around 137KB against it, so there is real headroom and
   * this gate protects it rather than blessing whatever today happened to be.
   *
   * Raising this number means changing that document in the same commit. It is a product
   * commitment about a patient on a slow connection, not a build detail.
   */
  '/': 150 * 1024,
}

const KIB = 1024
const kib = (bytes) => `${(bytes / KIB).toFixed(1)} KiB`

/**
 * Gzip each file on its own, the way a server compresses each response.
 *
 * Memoised because the same chunk appears on every route — the shared runtime is most of the
 * bundle — and compressing 220KB of JavaScript once per route per lookup would make this the
 * slowest step of the build for no better an answer.
 */
const sizeCache = new Map()
const sizeOf = (file) => {
  if (!sizeCache.has(file)) sizeCache.set(file, gzipSync(readFileSync(join(dist, file))).length)
  return sizeCache.get(file)
}
const gzippedSize = (files) => files.reduce((total, file) => total + sizeOf(file), 0)

/**
 * The JS a browser must fetch before this route is interactive, split by who fetches it.
 *
 * `legacyOnly` is the nomodule polyfill bundle; `shared` is the runtime and root layout every
 * route pays for; `own` is what this route adds on top.
 */
function firstLoadChunks(entry) {
  const shared = JSON.parse(readFileSync(join(dist, 'server/app', entry, 'build-manifest.json'), 'utf8'))

  // The manifest is a script that assigns onto globalThis. Handing `new Function` its own
  // object as the parameter named `globalThis` shadows the real one, so evaluating the build's
  // own output cannot reach anything outside this call.
  const sandbox = {}
  new Function('globalThis', readFileSync(join(dist, 'server/app', `${entry}_client-reference-manifest.js`), 'utf8'))(sandbox)
  const clientManifest = sandbox.__RSC_MANIFEST[entry]

  const normalise = (file) => file.replace(/^\/_next\//, '')
  const own = [
    ...Object.values(clientManifest.entryJSFiles ?? {}).flat(),
    ...Object.values(clientManifest.clientModules ?? {}).flatMap((mod) => mod.chunks ?? []),
  ].map(normalise)

  const legacyOnly = shared.polyfillFiles.map(normalise).filter((f) => f.endsWith('.js'))
  const modern = [...new Set([...shared.rootMainFiles.map(normalise), ...own])]
    .filter((f) => f.endsWith('.js') && !legacyOnly.includes(f))

  return { legacyOnly, modern }
}

const routesManifest = join(dist, 'app-path-routes-manifest.json')
let routes
try {
  routes = JSON.parse(readFileSync(routesManifest, 'utf8'))
} catch {
  console.error(
    `No production build to measure — ${routesManifest} is missing.\n` +
      'Run `pnpm --filter @carevelo/patient-portal build` first. This script reads a build; it never starts one.',
  )
  process.exit(1)
}

const measurements = Object.entries(routes)
  .map(([entry, route]) => {
    const { legacyOnly, modern } = firstLoadChunks(entry)
    const modernBytes = gzippedSize(modern)
    return {
      route,
      modernBytes,
      totalBytes: modernBytes + gzippedSize(legacyOnly),
      files: [...modern, ...legacyOnly],
      legacyOnly,
    }
  })
  .sort((a, b) => b.totalBytes - a.totalBytes || a.route.localeCompare(b.route))

console.log('\nPatient portal first-load JavaScript — gzipped, each chunk compressed as its own response\n')

for (const { route, totalBytes, modernBytes } of measurements) {
  const ceiling = CEILINGS[route]
  const verdict = ceiling === undefined
    ? 'not gated'
    : `${modernBytes <= ceiling ? 'within' : 'OVER'} ceiling ${kib(ceiling)}`

  console.log(
    `  ${route.padEnd(16)} ${kib(totalBytes).padStart(10)}` +
      `  (${kib(modernBytes)} on a module-capable browser)  ${verdict}`,
  )
}

// The per-chunk breakdown for gated routes only. On a failure this is the first thing anyone
// needs — "it is 4KB over" is not actionable, "this chunk grew by 4KB" is.
for (const { route, files, legacyOnly } of measurements.filter((m) => CEILINGS[m.route] !== undefined)) {
  console.log(`\n  ${route} is made of:`)
  for (const file of [...files].sort((a, b) => sizeOf(b) - sizeOf(a))) {
    const note = legacyOnly.includes(file) ? '  nomodule — legacy browsers only' : ''
    console.log(`    ${kib(sizeOf(file)).padStart(10)}  ${file}${note}`)
  }
}

const failures = measurements.filter(({ route, modernBytes }) => modernBytes > (CEILINGS[route] ?? Infinity))

console.log(`\n  Budget: ${kib(TARGET_BYTES)} — docs/30-architecture/frontend-nextjs.md:112`)
for (const { route, modernBytes } of measurements.filter((m) => CEILINGS[m.route] !== undefined)) {
  const gap = modernBytes - TARGET_BYTES
  console.log(
    gap > 0
      ? `  ${route} is ${kib(gap)} above that target. The ceiling below it is a ratchet, not the goal.`
      : `  ${route} is ${kib(-gap)} under that target.`,
  )
}

if (failures.length > 0) {
  console.error(
    '\nFirst-load JavaScript budget exceeded.\n' +
      failures
        .map(({ route, totalBytes }) =>
          `  ${route} ships ${kib(totalBytes)} gzipped; the ceiling is ${kib(CEILINGS[route])} ` +
          `(over by ${kib(totalBytes - CEILINGS[route])}).`)
        .join('\n') +
      '\n\nThe per-chunk breakdown above says where it went. Either take the weight back out, or — if\n' +
      'the growth is deliberate and justified — raise the ceiling in frontend/scripts/bundle-budget.mjs\n' +
      'in this same commit, so a reviewer sees the budget move as an explicit decision.\n' +
      'Do not raise it past 150 KiB without changing docs/30-architecture/frontend-nextjs.md too.',
  )
  process.exit(1)
}

console.log('\nEvery gated route is within its ceiling.\n')
