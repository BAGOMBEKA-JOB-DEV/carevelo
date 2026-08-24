import { expect, test, type Locator, type Page } from '@playwright/test'

/**
 * The sign-in form, on a screen.
 *
 * ONE ASSERTION, AND IT IS THE ONE THAT WAS MISSING. Every control the patient has to
 * touch — the email field, the password field, the button — is visible AND inside the
 * viewport when the page loads, without scrolling, at a laptop size and at a phone size.
 *
 * That is not a stylistic preference. It shipped broken: `components.css` owned `.field`
 * as the form row, `layout.css` reused the same class for the rider's full-height page
 * frame, and because layout is imported later and the specificity is identical, every
 * form row in the product silently became a 100vh column. On this page that put the
 * password input and the submit button a full viewport below the fold. A patient sees a
 * form with one box and nothing to press. They do not scroll — there is no affordance
 * saying to — they call the clinic, or they give up.
 *
 * NOT ONE BYTE-LEVEL ASSERTION IN THE PRODUCT COULD HAVE CAUGHT IT. The markup was right,
 * the class names were right, both stylesheets parsed, both were valid CSS, and the whole
 * unit suite was green. The bug lived in the interaction between two files, resolved by
 * the browser, at a size. That is why this spec opens a browser.
 *
 * WHY `toBeInViewport` AND NOT `toBeVisible` ALONE. Playwright's `toBeVisible` means "in
 * the layout with a non-empty box" — an element parked 900 pixels below the fold is
 * visible by that definition, which is precisely how the defect passed review. Being
 * inside the viewport at the position the page loads at is the property the patient
 * actually experiences. `ratio: 1` because half a button is not a button.
 *
 * NOTHING IS CLICKED OR FILLED HERE, deliberately. Any interaction scrolls the element
 * into view first, and an assertion made after Playwright has scrolled for you is an
 * assertion about a page nobody saw. The spec looks and does not touch.
 *
 * This does not sign anybody in — there is no seeded patient it could rely on, and a
 * spec that needed one would fail for reasons that are not layout. Reaching the form is
 * the whole test.
 *
 * @see playwright.config.ts — the two viewports, and why the browser is named outright
 * @see packages/ui/src/tokens/tokens.test.ts — the same bug caught by name and by shape,
 *      which is necessary and, as this file argues, not sufficient
 */

/** The three things a patient must be able to see to sign in. */
function controls(page: Page): Array<[string, Locator]> {
  return [
    // Found the way the patient finds them — by their labels and by the button's words —
    // rather than by class name. A CSS refactor that renames `.input` must not break this
    // spec, because a CSS refactor is exactly when the layout is at risk.
    ['the email field', page.getByLabel('Email address')],
    ['the password field', page.getByLabel('Password', { exact: true })],
    ['the sign-in button', page.getByRole('button', { name: 'Sign in' })],
  ]
}

test.describe('the sign-in form', () => {
  test('puts every control on the screen at once, without scrolling', async ({ page }) => {
    const response = await page.goto('/sign-in')

    // Asserted first, so a 404 from an unresolved tenant reports itself as a 404 rather
    // than as three missing locators.
    expect(response?.status(), 'the portal did not serve /sign-in').toBe(200)

    for (const [name, control] of controls(page)) {
      await expect(control, `${name} is not rendered`).toBeVisible()
      await expect(
        control,
        `${name} is rendered outside the viewport — a patient would never see it`,
      ).toBeInViewport({ ratio: 1 })
    }

    // The page must not have needed scrolling to satisfy any of the above. Nothing here
    // scrolls, so a non-zero offset would mean the page moved itself — and an assertion
    // made after that is an assertion about a view the patient never had.
    expect(await page.evaluate(() => window.scrollY)).toBe(0)
  })
})
