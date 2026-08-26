import { expect, test, type Page } from '@playwright/test'

const PORTAL = 'http://kira.localhost:3010'
const log: string[] = []

function watch(page: Page, who: string): void {
  page.on('console', (m) => log.push(`[${who}] console.${m.type()}: ${m.text()}`))
  page.on('pageerror', (e) => log.push(`[${who}] pageerror: ${e.message}`))
}

test.afterAll(() => {
  console.log('\n===== BROWSER CONSOLE =====')
  console.log(log.length === 0 ? '(nothing)' : log.join('\n'))
  console.log('===== END =====\n')
})

test('a page this change never touched emits the same font warnings', async ({ page }) => {
  watch(page, 'portal-services')
  await page.goto(`${PORTAL}/services`)
  await page.waitForLoadState('load')
  await page.waitForTimeout(6_000)
})
