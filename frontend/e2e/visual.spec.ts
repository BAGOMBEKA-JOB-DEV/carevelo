import { expect, test, type Page } from '@playwright/test'

/**
 * The visual regression gate.
 *
 * WHAT THIS EXISTS TO STOP, AND THE NUMBER BEHIND IT IS 477.
 *
 * That is how many `style={{…}}` there were across the four apps before the layout sweep:
 * 185 hand-set marginTop, 171 hand-set gap, 49 hand-set fontSize. None of it careless —
 * `var(--space-*)` appeared inline 404 times, so people reached for the right token and
 * had nowhere to put it. The sweep took it to 2, and the ESLint rule in eslint.config.js
 * now stops a THIRD one being written.
 *
 * But that rule only sees the shape `style={{…}}`. It cannot see a spacing decision
 * re-entering through a new class, a token quietly redefined, a `<Stack gap="2">` that
 * should have been a `gap="5"`, or a primitive whose default shifts under 337 call sites
 * at once. Those are changes to what the patient SEES, and there is exactly one way to
 * know what the patient sees, which is to open a browser and look at it.
 *
 * That is also the lesson of the defect that started all of this: `components.css` owned
 * `.field` as the form row and `layout.css` reused the name for the rider's page frame,
 * so every form field in the product silently became a 100vh column. Thirty-seven unit
 * assertions were green. The markup was right, both stylesheets were valid, and the
 * password box and the submit button sat a full viewport below the fold. A screenshot
 * diff would have shown it on the first run.
 *
 * ---------------------------------------------------------------------------------------
 * NOT PART OF `pnpm check`, AND THAT IS DELIBERATE.
 *
 * This needs the API, a seeded tenant and four dev servers. CI has none of them, and a
 * gate that fails for a reason that is not the change is a gate people stop reading. Run
 * it with `pnpm test:visual` against a stack you brought up yourself. What a CI job would
 * need is written out in .github/workflows/frontend.yml beside a commented stub.
 * ---------------------------------------------------------------------------------------
 *
 * DETERMINISM IS THE WHOLE VALUE. A baseline that fails tomorrow for a reason that is not
 * the change teaches people to run with --update-snapshots, and at that point the gate is
 * decorative. Three things are pinned here:
 *
 *   1. THE CLOCK. The console's schedule renders a date, and appointment lists render
 *      relative times. Baselined against the real clock they would go red at midnight.
 *      `page.clock.setFixedTime` freezes it at a fixed instant for every spec.
 *   2. THE THEME. Read from localStorage by public/theme-init.js before first paint, so it
 *      is seeded through an init script that runs before any document — not by clicking
 *      the toggle, which would capture a page mid-transition.
 *   3. ANIMATION. `animations: 'disabled'` in the assertion, and the portal's header
 *      frosts on scroll, so every shot is taken at scroll position zero.
 *
 * WHAT IS NOT PINNED, AND SO IS NOT BASELINED: any screen whose content is seeded data
 * that a re-seed would legitimately change (a specific patient record, a specific payment
 * intent). Those are listed at the bottom of this file with the reason. A flaky baseline
 * is worse than a missing one — the missing one is honest about its coverage.
 *
 * @see playwright.config.ts — the two viewports, and why the browser is named outright
 * @see e2e/sign-in.spec.ts — the layout assertion this file generalises
 * @see eslint.config.js — the rule that stops the shape; this stops the effect
 */

/*
 * ONE ORIGIN PER APP, because tenancy is resolved from the Host header: a request to
 * localhost rather than kira.localhost resolves to no clinic and renders the 404 page, so
 * the spec would be testing the 404 page and passing.
 *
 * The defaults are the ports each app's own `dev` script uses (see each app's package.json),
 * so `pnpm dev` at the workspace root gives a working stack with no environment set. Each
 * is overridable for a deployed environment, and locally for the case that bit this
 * project: another project on the machine had taken :3000, so the portal ran on :3010 and
 * every screenshot would silently have been of somebody else's website.
 */
const ORIGINS = {
  portal: process.env.PORTAL_ORIGIN ?? 'http://kira.localhost:3000',
  console: process.env.CONSOLE_ORIGIN ?? 'http://kira.localhost:3001',
  rider: process.env.RIDER_ORIGIN ?? 'http://kira.localhost:3002',
  platform: process.env.PLATFORM_ORIGIN ?? 'http://kira.localhost:3003',
} as const

/*
 * A fixed instant, in the middle of a working Thursday in Kampala so that a clinic's
 * opening-hours logic renders "open" rather than a weekend empty state. The value matters
 * far less than the fact that it never moves.
 */
const FROZEN_CLOCK = new Date('2026-08-20T09:30:00.000Z')

/* Seeded by the demo tenant. Credentials in a spec are only ever acceptable because these
   accounts exist solely in local seed data and can reach nothing. */
const PATIENT = { email: 'aisha-nambooze@kira.test', password: 'demo-password' }
const STAFF = { email: 'sarah-nakato@kira.test', password: 'demo-password' }

type Theme = 'light' | 'dark'

/**
 * Put the page in a known state before anything is captured.
 *
 * The theme is seeded through `addInitScript` rather than by clicking the toggle: the
 * toggle writes localStorage and flips an attribute AFTER hydration, so a shot taken near
 * it catches a transition. `theme-init.js` reads the same key before first paint, which is
 * the state a returning patient actually loads into.
 *
 * The key is spelled here rather than imported because public/theme-init.js is a plain
 * file served to the browser and has no module graph to export from — the same reason
 * ThemeToggle.tsx keeps its own copy, and the same commented pair.
 */
async function prepare(page: Page, theme: Theme): Promise<void> {
  await page.clock.setFixedTime(FROZEN_CLOCK)

  await page.addInitScript((value: string) => {
    try {
      window.localStorage.setItem('carevelo.theme', value)
    } catch {
      /* No storage access. The light theme is the default and needs no seeding. */
    }
  }, theme)
}

/**
 * Capture a screen, once the page has stopped moving.
 *
 * `maxDiffPixelRatio` rather than an exact match, and 0.2% rather than zero: text
 * rasterises a pixel differently between a machine with a GPU and one without, and a gate
 * that goes red over subpixel antialiasing is a gate that gets bypassed. 0.2% of a
 * 1366x900 viewport is about 2,400 pixels — far below a moved element, far above hinting.
 *
 * `fullPage` is deliberately OFF. A full-page shot of a long list is mostly rows of seeded
 * data, so a re-seed rewrites the baseline for reasons that have nothing to do with
 * layout. The viewport is what the patient sees on arrival, and it is where the defects
 * this file exists for actually live — above the fold.
 */
async function shoot(page: Page, name: string): Promise<void> {
  // The portal's header frosts on scroll and its at-rest state inverts over the hero.
  // Every shot is taken at the top so the two cannot disagree between runs.
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForLoadState('networkidle')

  await expect(page).toHaveScreenshot(`${name}.png`, {
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.002,
  })
}

/** Sign in through the form, because that is the only way a session cookie is issued. */
async function signIn(
  page: Page,
  origin: string,
  who: { email: string; password: string },
): Promise<void> {
  await page.goto(`${origin}/sign-in`)
  await page.getByLabel(/email/i).fill(who.email)
  await page.getByLabel(/password/i).fill(who.password)
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'))
}

/*
 * THE PUBLIC SCREENS, both themes.
 *
 * These need no session and no seeded record beyond the tenant itself, which makes them
 * the most durable baselines in the file — and they are also the ones a patient meets
 * first, so a regression here is the most expensive one.
 */
const PUBLIC_SCREENS = [
  { app: 'portal', path: '/', name: 'portal-landing' },
  { app: 'portal', path: '/sign-in', name: 'portal-sign-in' },
  { app: 'portal', path: '/services', name: 'portal-services' },
  { app: 'portal', path: '/privacy', name: 'portal-privacy' },
  { app: 'rider', path: '/sign-in', name: 'rider-sign-in' },
  { app: 'console', path: '/sign-in', name: 'console-sign-in' },
] as const

for (const theme of ['light', 'dark'] as const) {
  test.describe(`public screens — ${theme}`, () => {
    for (const screen of PUBLIC_SCREENS) {
      test(`${screen.name} (${theme})`, async ({ page }) => {
        await prepare(page, theme)
        await page.goto(`${ORIGINS[screen.app]}${screen.path}`)
        await shoot(page, `${screen.name}-${theme}`)
      })
    }
  })
}

/*
 * THE PATIENT'S OWN SCREENS.
 *
 * One sign-in per test rather than a shared storage state: these run fullyParallel, and a
 * session reused across workers is a session one worker can sign out from underneath
 * another. Slower, and the slowness is not on any patient's path.
 */
for (const theme of ['light', 'dark'] as const) {
  test.describe(`patient screens — ${theme}`, () => {
    const SCREENS = [
      { path: '/account', name: 'portal-account' },
      { path: '/book', name: 'portal-book' },
      { path: '/prescriptions', name: 'portal-prescriptions' },
      { path: '/appointments', name: 'portal-appointments' },
    ] as const

    for (const screen of SCREENS) {
      test(`${screen.name} (${theme})`, async ({ page }) => {
        await prepare(page, theme)
        await signIn(page, ORIGINS.portal, PATIENT)
        await page.goto(`${ORIGINS.portal}${screen.path}`)
        await shoot(page, `${screen.name}-${theme}`)
      })
    }
  })
}

/*
 * THE CONSOLE, WHICH IS WHERE STAFF SPEND THE WHOLE DAY.
 *
 * The densest surface in the product and the one where a spacing regression costs the most
 * — a queue that gains 8px a row is a queue that fits three fewer patients on a screen.
 * Dark is included because this app's palette (--sidebar-bg: #151816) was written long
 * before anything rendered it, and a baseline is how it stays rendered.
 */
for (const theme of ['light', 'dark'] as const) {
  test.describe(`console screens — ${theme}`, () => {
    const SCREENS = [
      { path: '/patients', name: 'console-patients' },
      { path: '/pharmacy', name: 'console-pharmacy' },
      { path: '/dispatch', name: 'console-dispatch' },
      { path: '/schedule', name: 'console-schedule' },
      { path: '/settings', name: 'console-settings' },
    ] as const

    for (const screen of SCREENS) {
      test(`${screen.name} (${theme})`, async ({ page }) => {
        await prepare(page, theme)
        await signIn(page, ORIGINS.console, STAFF)
        await page.goto(`${ORIGINS.console}${screen.path}`)
        await shoot(page, `${screen.name}-${theme}`)
      })
    }
  })
}

/*
 * SCREENS DELIBERATELY NOT BASELINED, and why. Coverage that is honest about its holes is
 * worth more than coverage that quietly excludes what it could not make pass.
 *
 * - /patients/[patient], /payments/records/[paymentIntent], /prescriptions/[prescription],
 *   /dispatch/[delivery], /assignments/[delivery] — every one is keyed on a seeded record
 *   id. The id changes on re-seed, so the URL is not stable, and the CONTENT is the
 *   record, so a re-seed rewrites the image for a reason that is not a layout change.
 *   Worth adding once the seeder pins ids for a known demo patient.
 *
 * - rider /assignments and /completed — the rider surface only has content while a
 *   delivery is assigned to the signed-in rider, which is state a spec would have to
 *   create through the console first. A baseline of a permanently empty list would assert
 *   that the empty state is correct and nothing about the screen the rider actually uses.
 *
 * - platform-admin /tenants — the list is every tenant on the installation, which differs
 *   between a developer's machine and any shared environment by design.
 *
 * - /pay/*, /payments/[payment] — a payment screen shows aggregator state that moves on
 *   its own. Nothing here can freeze it, and a baseline of a moving target is a red build
 *   waiting for a date.
 */
