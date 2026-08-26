import { expect, test, type Page } from '@playwright/test'

const PORTAL = 'http://kira.localhost:3010'
const CONSOLE_APP = 'http://kira.localhost:3001'
const APPT = process.env.DRIVE_APPOINTMENT ?? ''

const log: string[] = []

function watch(page: Page, who: string): void {
  page.on('console', (m) => log.push(`[${who}] console.${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => log.push(`[${who}] pageerror: ${e.message}`))
  page.on('requestfailed', (r) => log.push(`[${who}] requestfailed: ${r.method()} ${r.url()} — ${r.failure()?.errorText ?? ''}`))
  page.on('response', (r) => {
    if (r.status() >= 400) log.push(`[${who}] http ${r.status()}: ${r.request().method()} ${r.url()}`)
  })
}

async function signIn(page: Page, origin: string, email: string): Promise<void> {
  await page.goto(`${origin}/sign-in`)
  await page.getByLabel(/email/i).fill(email)
  await page.getByLabel(/password/i).fill('demo-password')
  await page.getByRole('button', { name: /sign in/i }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), { timeout: 60_000 })
}

test.afterAll(() => {
  console.log('\n===== BROWSER CONSOLE =====')
  console.log(log.length === 0 ? '(nothing)' : log.join('\n'))
  console.log('===== END =====\n')
})

test('patient sends a message from the portal', async ({ page }) => {
  watch(page, 'portal')
  await signIn(page, PORTAL, 'aisha-nambooze@kira.test')

  await page.goto(`${PORTAL}/consultations/${APPT}`)
  await page.getByRole('button', { name: /go into the consultation/i }).click()
  await page.waitForURL(new RegExp(`/consultations/${APPT}`), { timeout: 60_000 })

  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible()
  await expect(page.getByText('Nothing has been written here yet.')).toBeVisible()

  // The media pane's honest branch: unconfigured, so the phone number, not a dead room.
  await expect(page.getByText(/Video and voice are not switched on yet/i)).toBeVisible()

  const box = page.getByLabel(/write to the clinician/i)
  await box.fill('Since Tuesday the cough is worse at night.\nI have not taken anything for it.')

  // The draft must survive a navigation — this is the requirement, driven.
  await page.reload()
  await expect(page.getByLabel(/write to the clinician/i)).toHaveValue(
    'Since Tuesday the cough is worse at night.\nI have not taken anything for it.',
  )

  await page.getByRole('button', { name: /^send$/i }).click()
  await expect(page.getByText('Since Tuesday the cough is worse at night.')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('I have not taken anything for it.')).toBeVisible()
  await expect(page.getByLabel(/write to the clinician/i)).toHaveValue('')
})

test('clinic_admin is refused the room, as the route intends', async ({ page }) => {
  watch(page, 'console-admin')
  await signIn(page, CONSOLE_APP, 'sarah-nakato@kira.test')
  await page.goto(`${CONSOLE_APP}/schedule/room/${APPT}`)
  await expect(page.getByText(/This is a clinician’s screen/i)).toBeVisible()
})

test('clinician reads and answers from the console', async ({ page }) => {
  watch(page, 'console')
  await signIn(page, CONSOLE_APP, 'dr-ronald-okello@kira.test')

  await page.goto(`${CONSOLE_APP}/schedule/room/${APPT}`)
  const door = page.getByRole('button', { name: /rejoin|go in|open the consultation|start/i }).first()
  if (await door.isVisible().catch(() => false)) {
    await door.click()
    await page.waitForLoadState('networkidle')
  }

  await expect(page.getByRole('heading', { name: 'Messages' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Since Tuesday the cough is worse at night.')).toBeVisible()

  const box = page.getByLabel(/write to the patient/i)
  await box.fill('Start the amoxicillin tonight.\nStop the other tablets until we speak again.')
  await page.getByRole('button', { name: /^send$/i }).click()
  await expect(page.getByText('Stop the other tablets until we speak again.')).toBeVisible({ timeout: 30_000 })
})
