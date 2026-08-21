import react from '@vitejs/plugin-react'

/**
 * One runner for the whole workspace.
 *
 * Until now the only tests in this tree lived in packages/ui and ran through
 * `pnpm -r test`, which meant that a test written anywhere else was a test nobody
 * executed: `pnpm -r` only runs the script in the packages that declare one, and the
 * four apps declare none. That is the same shape of silent failure this project keeps
 * finding — the lint script wired into every package and never run, the command
 * scheduled nowhere, the column nothing wrote. A file matching `*.test.ts` should be a
 * file that runs, and after this config it is.
 *
 * MIGRATED, NOT DOUBLED UP. The root `test` script no longer calls `pnpm -r test`; it
 * calls this config, whose `ui` project runs exactly the suite that script used to.
 * Keeping both would run the packages/ui suite twice per `pnpm check`, and two runs of
 * the same thing is how a green board stops meaning anything.
 *
 * packages/ui keeps its own `test` script and it still works — but note what it now does,
 * because it surprised me and it will surprise the next person: vitest walks UP from its
 * working directory looking for a config, finds this one, and runs every project in it.
 * So `pnpm --filter @carevelo/ui test` executes the whole workspace suite rather than
 * that package's share of it. Harmless — same tests, same result, no duplication within a
 * run — and it means there is exactly one definition anywhere in this tree of what "the
 * tests" are. Narrow it with `--project ui` when iterating on one package.
 *
 * WHY THERE IS NO `defineConfig` IMPORT HERE, WHICH LOOKS LIKE A MISTAKE AND IS NOT.
 * Vite bundles this file and resolves its bare imports from THIS directory, and vitest
 * is not a dependency of the workspace root — it is a devDependency of packages/ui, the
 * only package that had tests when it was added. Importing `vitest/config` here fails at
 * config-load time with ERR_MODULE_NOT_FOUND before a single test runs. `defineConfig`
 * is an identity function whose entire job is to attach types, so the object literal
 * below is the same configuration with one less way to break. If vitest is ever added to
 * the root package.json, put the import back.
 *
 * That is also why the root `test` script spells out `packages/ui/node_modules/.bin/vitest`
 * rather than `vitest`: pnpm only puts a package's own dependencies on its PATH, and the
 * root has no vitest to put there. It is the same 4.1.10 the workspace pins.
 *
 * ONE THING IS OUTSTANDING, AND IT IS WRITTEN DOWN HERE RATHER THAN LEFT TO BE
 * REDISCOVERED. apps/patient-portal does not declare vitest either, and unlike the config
 * loader above, `tsc` and dependency-cruiser cannot be worked around: both resolve
 * `import { it } from 'vitest'` the way Node does, by walking up from the importing file,
 * and pnpm's isolated layout puts vitest nowhere on that path. So the suite RUNS — vitest
 * resolves its own package — while `pnpm typecheck` and `pnpm boundaries` report the
 * import as unresolvable for that app. The fix is one line and one install:
 *
 *     pnpm --filter @carevelo/patient-portal add -D vitest@4.1.10
 *
 * It is not done here because it edits a package.json and touches the lockfile, and a
 * package.json edit without the matching install is worse than the gap it closes: the
 * lockfile goes stale and CI's `--frozen-lockfile` fails for everybody. Left visible on
 * purpose rather than papered over with a node_modules symlink that would be green on one
 * machine and red on the next.
 *
 * PROJECTS RATHER THAN ONE ENVIRONMENT, because the two suites want opposite things.
 * packages/ui parses its own CSS as text and reads files off disk with node:fs relative
 * to `import.meta.url` — it wants node and would gain nothing but a second of jsdom
 * startup from a DOM it never touches. The app tests render and mock `next/headers` —
 * they want jsdom and the app's own `@/` alias. Neither project inherits from the other,
 * so a change made for one cannot quietly alter the other.
 *
 * WHAT IS DELIBERATELY NOT HERE: e2e/. Those are Playwright specs, they need a running
 * server and a browser, and they are reached through `pnpm test:e2e` alone. Every
 * project below is rooted inside a package and includes only `src/**`, so the e2e
 * directory at the workspace root cannot be swept up by accident — and `pnpm check`,
 * which CI runs with no server anywhere, stays honest.
 *
 * @see playwright.config.ts — the other half, and why it is a separate script
 */

const workspace = (path: string): string =>
  new URL(path, import.meta.url).pathname

const patientPortal = workspace('./apps/patient-portal')

export default {
  test: {
    projects: [
      /*
       * packages/ui — node, and the environment matters.
       *
       * tokens.test.ts walks src/tokens/*.css with readdirSync and parses the text; it
       * resolves that directory from its own `import.meta.url`, so `root` below moves
       * nothing under it. Kept on node because that suite has no DOM in it: jsdom would
       * be a second of startup and one more thing that could change what `document`
       * means in a file that never asks.
       */
      {
        test: {
          name: 'ui',
          root: workspace('./packages/ui'),
          environment: 'node',
          include: ['src/**/*.test.ts'],
          restoreMocks: true,
          unstubEnvs: true,
          unstubGlobals: true,
          setupFiles: [workspace('./vitest.setup.ts')],
        },
      },

      /*
       * apps/patient-portal — jsdom, because this is the surface that renders for
       * patients and its tests stand in for a browser.
       *
       * The alias is the app's own `@/*` from its tsconfig, repeated here because vitest
       * resolves modules itself and does not read tsconfig paths. It has to match: the
       * boundary rules were once blind to `@/` imports for exactly this reason — a path
       * mapping that resolves to nothing does not fail, it silently stops checking.
       *
       * The React plugin is here rather than at the top so component tests (.tsx) work
       * the day someone writes one, without a second decision about JSX.
       */
      {
        plugins: [react()],
        resolve: {
          alias: { '@': `${patientPortal}/src` },
        },
        test: {
          name: 'patient-portal',
          root: patientPortal,
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}'],
          restoreMocks: true,
          unstubEnvs: true,
          unstubGlobals: true,
          setupFiles: [workspace('./vitest.setup.ts')],
        },
      },
    ],
  },
}
