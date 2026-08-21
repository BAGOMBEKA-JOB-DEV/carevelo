import { defineConfig } from '@playwright/test'

/**
 * The browser tests, and the gap they exist to close.
 *
 * Every assertion in `pnpm test` is a byte-level one: this function returns that value,
 * this file contains that string. All 37 of them were green on the day the sign-in page
 * shipped with its password field and its submit button rendered a full viewport below
 * the fold. Nothing was wrong with any byte. `components.css` owned `.field` as the form
 * row and `layout.css` reused the name for the rider's page frame; layout is imported
 * later, the specificity is identical, so every form field in the product silently became
 * a 100vh column. The tokens test now catches that particular collision by name and by
 * shape — but only that shape. A form whose button cannot be seen reads to the patient as
 * a form with no button, and there is only one way to know it is visible, which is to
 * open it in a browser and look.
 *
 * SO THIS IS A SEPARATE SCRIPT, ON PURPOSE. `pnpm test:e2e`, never `pnpm check`. These
 * specs need a portal on :3000 AND the API behind it — /sign-in resolves the clinic from
 * the Host header before it renders a single element — and CI has neither. Wiring them
 * into the gate would mean a gate that fails for a reason that is not the change, which
 * is how a red build stops being read.
 *
 * NO `webServer` BLOCK, FOR THE SAME REASON. Playwright could start `next dev` here, and
 * it would produce a portal with no API behind it: every page a 404, every spec failing
 * on a locator, and half an hour lost to a layout bug that does not exist. A connection
 * refused against :3000 is a clearer message than a green server serving nothing. Bring
 * the stack up yourself — `pnpm dev` here and `php artisan serve` in backend/ — and then
 * run this.
 *
 * THE BROWSERS COME FROM THE SHARED CACHE, which is why nothing below points at one.
 * Playwright resolves them from its own per-platform location (~/.cache/ms-playwright on
 * Linux) unless PLAYWRIGHT_BROWSERS_PATH says otherwise. Hard-coding that path here would
 * be correct on this machine and wrong on the next two, and the failure mode of a wrong
 * path is not an error — it is a silent re-download of 150MB.
 *
 * @see e2e/sign-in.spec.ts
 * @see vitest.config.ts — the other half, and why it is a separate runner
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,

  // A layout assertion that only passes sometimes is a layout that only works sometimes.
  // Retrying one until it goes green would hide exactly the class of bug this exists for.
  retries: 0,
  forbidOnly: !!process.env.CI,

  /*
   * Generous, because the first request to a route in `next dev` compiles it. Thirty
   * seconds of cold compile is normal and is not a failure; the shorter default turns it
   * into one, and then somebody spends an afternoon on a timeout that meant nothing.
   */
  timeout: 60_000,
  expect: { timeout: 15_000 },

  reporter: [['list']],

  /*
   * Traces and screenshots land inside node_modules rather than in a `test-results/`
   * directory at the workspace root, because .gitignore does not cover one and an
   * untracked pile of PNGs beside package.json is how a 40MB trace ends up in a commit.
   * Disposable either way. (Adding `test-results/` to .gitignore and taking Playwright's
   * default back would be tidier; that file is not this change's to edit.)
   */
  outputDir: 'node_modules/.cache/playwright',

  use: {
    /*
     * The CLINIC's subdomain, not localhost. Tenancy is resolved from the Host header, so
     * http://localhost:3000/sign-in resolves to no clinic and renders a 404 — the page
     * under test would never exist. Overridable for a deployed environment, but the
     * default has to be a real tenant or the spec is testing the 404 page.
     */
    baseURL: process.env.PORTAL_ORIGIN ?? 'http://kira.localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  /*
   * TWO VIEWPORTS, AND THEY ARE THE POINT. The defect that motivated this file was
   * invisible at one size and fatal at another, so a single viewport would have proved
   * nothing. 1366x900 is the laptop a clinic's front desk uses; 390x844 is the phone the
   * patient this product is built for is holding.
   *
   * Chromium named outright rather than spread from a `devices` descriptor: the desktop
   * descriptors pin `channel: 'chrome'`, which needs branded Chrome on the machine, and
   * the phone descriptors default to WebKit. Only the chromium build is in the cache, so
   * either one turns a layout failure into an install failure.
   */
  projects: [
    {
      name: 'laptop-1366x900',
      use: { browserName: 'chromium', viewport: { width: 1366, height: 900 } },
    },
    {
      name: 'phone-390x844',
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        // So the page is laid out the way a handset lays it out, meta viewport included,
        // rather than as a very narrow desktop.
        isMobile: true,
        hasTouch: true,
        deviceScaleFactor: 3,
      },
    },
  ],
})
