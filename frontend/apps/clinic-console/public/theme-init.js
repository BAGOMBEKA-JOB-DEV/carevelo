/*
 * Carevelo — apply the stored theme before the first paint. Clinic console.
 *
 * THIS IS A DELIBERATE COPY OF apps/patient-portal/public/theme-init.js AND IT CANNOT BE
 * SHARED. A file in public/ is served verbatim by the app that owns it; there is no module
 * graph, no import and no bundler step, so a script in packages/ui could not reach the
 * browser here without being copied into this directory at build time by a script that
 * would itself need writing, testing and remembering. Two eleven-line files that must
 * agree are cheaper than one build step that can silently stop running. What holds them in
 * agreement is the storage key and the attribute, and both are named in ThemeToggle.tsx,
 * which is the third party to the contract and the only one written in TypeScript.
 *
 * WHY THIS FILE EXISTS
 * The theme is a user choice held in localStorage, which the server cannot read, so the
 * first HTML byte is always the light theme. Without this script a member of staff who
 * chose dark gets a full white page painted first and corrected once React hydrates. The
 * portal's version of this argument is about a patient on 3G; here it is about a
 * dispensary. This console is on screen at a counter for a whole shift, often in a room
 * lit for the people in it rather than for the screen, and a white flash on every
 * navigation — every navigation, because this app's nav is plain <a> and each click is a
 * document load — is not a cosmetic annoyance at that duty cycle. It is the thing that
 * sends somebody back to the light theme and then complains that dark mode is broken.
 *
 * WHY AN EXTERNAL FILE RATHER THAN AN INLINE SCRIPT
 * src/proxy.ts sets `script-src 'self' 'nonce-…' 'strict-dynamic'` with no 'unsafe-inline'.
 * An inline script would force an 'unsafe-inline' that gives up the control entirely, or a
 * hash that stops matching the day somebody edits a comment in here and fails silently. A
 * file served from our own origin, handed this request's nonce by the root layout, needs
 * neither. Note that being same-origin is NOT sufficient on its own: 'strict-dynamic'
 * discards 'self', so the nonce in layout.tsx is load-bearing rather than belt-and-braces.
 *
 * WHY prefers-color-scheme IS IGNORED
 * By decision, not by omission, and the decision is the same one colors.css records. The
 * theme is entirely the user's, and persisted. A phone or a laptop deciding it is evening
 * says nothing about the glare on the screen at a clinic's front desk, and a console that
 * changed colour at dusk under a member of staff mid-way through pricing an order would be
 * making a choice nobody asked it to make. Light is the ABSENCE of data-theme: every light
 * value sits on bare :root, which means the default costs nothing, cannot be half-applied,
 * and is what an old browser that has never heard of any of this gets.
 *
 * WHY THE try/catch
 * Not padding. `localStorage` THROWS on access — not returns null — in Safari private
 * browsing and under some managed-device policies, and a shared clinic terminal is exactly
 * the kind of machine that carries such a policy. A colour preference must never be able to
 * stop the front desk reaching a patient's record, so the failure mode here is "you get the
 * light theme" and never "the page dies before it renders". The catch binding is omitted
 * rather than named and unused.
 *
 * This must stay render-blocking, in the document before anything paints, and ahead of
 * the app bundle.
 *
 * @see packages/ui/src/theme/ThemeToggle.tsx — the other half: same key, same attribute
 * @see packages/ui/src/tokens/colors.css — what data-theme="dark" actually switches
 * @see apps/clinic-console/src/app/console.css — the contrast corrections dark needs here
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
