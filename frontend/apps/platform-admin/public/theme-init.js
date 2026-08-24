/*
 * Carevelo — apply the stored theme before the first paint. Platform admin.
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
 * first HTML byte is always the light theme. Without this script an operator who chose dark
 * gets a full white page painted first and corrected once React hydrates. The portal makes
 * this argument about a patient on 3G, and the flash is shorter here — this is a desk
 * machine on an office connection. What is longer is the exposure: this surface is the one
 * somebody sits in front of during an incident, at the hour incidents happen, reading a
 * break-glass register. A full-screen white flash on every navigation — every navigation,
 * because this app's nav is plain <a> elements and each click is a document load — is what
 * sends that person back to the light theme and then reports that dark mode is broken.
 *
 * WHY AN EXTERNAL FILE RATHER THAN AN INLINE SCRIPT
 * src/proxy.ts sets `script-src 'self' 'nonce-…' 'strict-dynamic'` with no 'unsafe-inline'.
 * An inline script would force an 'unsafe-inline' that gives up the control entirely, or a
 * hash that stops matching the day somebody edits a comment in here and fails silently. A
 * file served from our own origin, handed this request's nonce by the root layout, needs
 * neither. Note that being same-origin is NOT sufficient on its own: 'strict-dynamic'
 * discards 'self', so the nonce in layout.tsx is load-bearing rather than belt-and-braces.
 *
 * That directive matters more here than anywhere else in the product: this is the session
 * that can authorise a break-glass into a clinic's records, so the rule that stops an
 * injected string becoming code is the one worth not bending for a colour preference.
 *
 * WHY prefers-color-scheme IS IGNORED
 * By decision, not by omission, and the decision is the same one colors.css records. The
 * theme is entirely the user's, and persisted. An operating system deciding it is evening
 * says nothing about the light in the room, and a screen that changed colour underneath
 * somebody part-way through reviewing a grant would be making a choice nobody asked it to
 * make. Light is the ABSENCE of data-theme: every light value sits on bare :root, which
 * means the default costs nothing, cannot be half-applied, and is what an old browser that
 * has never heard of any of this gets.
 *
 * WHY THE try/catch
 * Not padding. `localStorage` THROWS on access — not returns null — in Safari private
 * browsing and under managed-device policies, and a machine with access to the control
 * plane is exactly the kind of machine that carries such a policy. A colour preference must
 * never be able to stop an operator reaching the break-glass register, so the failure mode
 * here is "you get the light theme" and never "the page dies before it renders". The catch
 * binding is omitted rather than named and unused.
 *
 * This must stay render-blocking, in the document before anything paints, and ahead of
 * the app bundle.
 *
 * @see packages/ui/src/theme/ThemeToggle.tsx — the other half: same key, same attribute
 * @see packages/ui/src/tokens/colors.css — what data-theme="dark" actually switches
 * @see apps/platform-admin/src/app/admin.css — the contrast corrections dark needs here
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
