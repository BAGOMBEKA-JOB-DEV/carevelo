/*
 * Carevelo — apply the stored theme before the first paint.
 *
 * WHY THIS FILE EXISTS
 * The theme is a user choice held in localStorage, which the server cannot read, so the
 * first HTML byte is always the light theme. Without this script a returning patient who
 * chose dark gets a full white page painted first and corrected once React hydrates. On
 * a mid-range Android phone on 3G that gap is hundreds of milliseconds — long enough to
 * be seen, and a flash on a screen showing someone's prescription reads as a broken
 * page rather than a slow one. This runs while the parser is blocked, so the right
 * theme is the first thing on screen and there is nothing to correct.
 *
 * WHY AN EXTERNAL FILE RATHER THAN AN INLINE SCRIPT
 * next.config.ts sets `script-src 'self'` with no 'unsafe-inline', deliberately: this
 * surface renders a patient's own health information, and scripts are the part of a CSP
 * that could exfiltrate it. An inline script would force one of three things — an
 * 'unsafe-inline' that gives up the control entirely, a per-response nonce threaded
 * through the render, or a hash that stops matching the day someone edits a comment in
 * here and fails silently. A file served from our own origin needs none of them. The
 * theme bends to the CSP; the CSP does not bend to the theme.
 *
 * WHY prefers-color-scheme IS IGNORED
 * By decision, not by omission. The theme is entirely the user's, and persisted:
 *   - A patient standing outside a pharmacy at 7pm, reading a dosage off their phone,
 *     needs the LIGHT theme, because that is the one that survives daylight. Their
 *     phone deciding it is evening says nothing about the glare on the screen.
 *   - The clinic's brand colour arrived from GET /v1/tenant and was chosen — and
 *     contrast-checked, server-side — against white. Swapping the ground underneath it
 *     because of an OS setting the clinic never saw is not a decision we are entitled
 *     to make on their behalf.
 * So light is the ABSENCE of data-theme: every light value sits on bare :root, which
 * means the default costs nothing, cannot be half-applied, and is what an old browser
 * that has never heard of any of this gets.
 *
 * WHY THE try/catch
 * Not padding. `localStorage` THROWS on access — not returns null — in Safari private
 * browsing and under some managed-device and embedded-webview policies. A colour
 * preference must never be able to stop a patient reading their prescription, so the
 * failure mode here is "you get the light theme" and never "the page dies before it
 * renders". The catch binding is omitted rather than named and unused.
 *
 * This must stay render-blocking, in the document before anything paints, and ahead of
 * the app bundle.
 *
 * @see packages/ui/src/theme/ThemeToggle.tsx — the other half: same key, same attribute
 * @see packages/ui/src/tokens/colors.css — what data-theme="dark" actually switches
 */
(function () {
  try {
    if (localStorage.getItem('carevelo.theme') === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark')
    }
  } catch {
    /* No storage access. The light theme is already the default; leave it alone. */
  }
})()
