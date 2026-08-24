/*
 * Carevelo — apply the stored theme before the first paint. Rider view.
 *
 * THIS IS A DELIBERATE COPY OF apps/patient-portal/public/theme-init.js AND IT CANNOT BE
 * SHARED. A file in public/ is served verbatim by the app that owns it; there is no module
 * graph, no import and no bundler step, so a script in packages/ui could not reach the
 * browser here without being copied into this directory at build time by a script that
 * would itself need writing, testing and remembering. Four eleven-line files that must
 * agree are cheaper than one build step that can silently stop running. What holds them in
 * agreement is the storage key and the attribute, and both are named in ThemeToggle.tsx,
 * which is the fifth party to the contract and the only one written in TypeScript.
 *
 * WHY THIS FILE EXISTS
 * The theme is a user choice held in localStorage, which the server cannot read, so the
 * first HTML byte is always the light theme. Without this script a rider who chose dark
 * gets a full white page painted first and corrected once React hydrates. The portal makes
 * this argument about a patient on 3G; on this surface every clause of it is worse. The
 * device is a mid-range Android phone on a patchy connection, so the gap between the paint
 * and the correction is at its longest here. The rider is holding the phone at arm's length
 * at a junction, so a full-screen white flash at night is not a cosmetic annoyance — it is
 * a headlight, at the moment somebody is deciding whether they are at the right address.
 * And this app's navigation is plain <a> elements, so the flash is not once per session but
 * once per tap.
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
 * theme is entirely the user's, and persisted. A phone deciding it is evening says nothing
 * about the light the screen is actually being read in: a rider under a sodium lamp at 8pm
 * and a rider in full midday sun are both outdoors, and only one of them wants the dark
 * theme. Sunlight is the harder case and it wants LIGHT, which is the default — so a phone
 * that switched itself to dark at dusk and stayed there would be wrong for the rider's next
 * morning. Light is the ABSENCE of data-theme: every light value sits on bare :root, which
 * means the default costs nothing, cannot be half-applied, and is what an old browser that
 * has never heard of any of this gets.
 *
 * WHY THE try/catch
 * Not padding. `localStorage` THROWS on access — not returns null — in Safari private
 * browsing, under some managed-device policies, and inside the embedded webviews a rider's
 * phone is most likely to open a link in. A colour preference must never be able to stop a
 * rider marking a delivery, so the failure mode here is "you get the light theme" and never
 * "the page dies before it renders". The catch binding is omitted rather than named and
 * unused.
 *
 * This must stay render-blocking, in the document before anything paints, and ahead of
 * the app bundle.
 *
 * @see packages/ui/src/theme/ThemeToggle.tsx — the other half: same key, same attribute
 * @see packages/ui/src/tokens/colors.css — what data-theme="dark" actually switches
 * @see apps/rider-view/src/app/rider.css — the contrast corrections dark needs here
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
