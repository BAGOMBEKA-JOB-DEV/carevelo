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

test('the configured branch reaches the seam, not a dead room', async ({ page }) => {
  watch(page, 'portal-configured')
  await signIn(page, PORTAL, 'aisha-nambooze@kira.test')

  // A fresh entry, so the cookie carries `configured: true` from the LiveKit binding.
  await page.goto(`${PORTAL}/consultations/${APPT}`)
  const enter = page.getByRole('button', { name: /go into the consultation/i })
  if (await enter.isVisible().catch(() => false)) {
    await enter.click()
    await page.waitForURL(new RegExp(`/consultations/${APPT}`), { timeout: 60_000 })
  }

  await expect(page.getByText(/There is no picture on this page yet/i)).toBeVisible()
  await expect(page.getByText(/You can still type to the clinician/i)).toBeVisible()
  await expect(page.getByText(/you are joined as the patient/i)).toBeVisible()

  // The chat surface is unaffected by the media leg — that is the whole point of pairing them.
  await expect(page.getByLabel(/write to the clinician/i)).toBeVisible()
})

test('the console seam names the provider and keeps the room usable', async ({ page }) => {
  watch(page, 'console-configured')
  await signIn(page, CONSOLE_APP, 'dr-ronald-okello@kira.test')
  await page.goto(`${CONSOLE_APP}/schedule/room/${APPT}`)

  const door = page.getByRole('button', { name: /rejoin|go in|start/i }).first()
  if (await door.isVisible().catch(() => false)) {
    await door.click()
    await page.waitForLoadState('networkidle')
  }

  await expect(page.getByText(/This console has no video client in it yet/i)).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('livekit')).toBeVisible()
  await expect(page.getByLabel(/write to the patient/i)).toBeVisible()
})

test('a message arrives on the other side through the poll, not a broadcast', async ({ browser }) => {
  const patientContext = await browser.newContext()
  const clinicianContext = await browser.newContext()
  const patient = await patientContext.newPage()
  const clinician = await clinicianContext.newPage()
  watch(patient, 'poll-patient')
  watch(clinician, 'poll-clinician')

  await signIn(patient, PORTAL, 'aisha-nambooze@kira.test')
  await patient.goto(`${PORTAL}/consultations/${APPT}`)
  const enter = patient.getByRole('button', { name: /go into the consultation/i })
  if (await enter.isVisible().catch(() => false)) {
    await enter.click()
    await patient.waitForURL(new RegExp(`/consultations/${APPT}`), { timeout: 60_000 })
  }
  await expect(patient.getByRole('heading', { name: 'Messages' })).toBeVisible()

  await signIn(clinician, CONSOLE_APP, 'dr-ronald-okello@kira.test')
  await clinician.goto(`${CONSOLE_APP}/schedule/room/${APPT}`)
  const door = clinician.getByRole('button', { name: /rejoin|go in|start/i }).first()
  if (await door.isVisible().catch(() => false)) {
    await door.click()
    await clinician.waitForLoadState('networkidle')
  }

  const sentence = `Come back on Friday if it has not settled. ${Date.now()}`
  await clinician.getByLabel(/write to the patient/i).fill(sentence)
  await clinician.getByRole('button', { name: /^send$/i }).click()
  await expect(clinician.getByText(sentence)).toBeVisible({ timeout: 30_000 })

  // The patient's page was never touched. The 15s poll notices the count changed and the
  // SERVER re-renders the line — the browser is never handed a body on a frame.
  await expect(patient.getByText(sentence)).toBeVisible({ timeout: 45_000 })

  await patientContext.close()
  await clinicianContext.close()
})
