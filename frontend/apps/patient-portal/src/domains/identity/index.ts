/**
 * The identity domain's PUBLIC SURFACE.
 *
 * Signing in, choosing a password, signing out, and reading who the caller is. Everything
 * else in this folder is internal: the cookie-forwarding in api/session.ts is the kind of
 * plumbing that should have exactly one way in.
 *
 * The whole surface is here: signing in is an email address and a password, and there is
 * nothing else to export.
 */
export { SignInForm } from './components/SignInForm'
export { SetPasswordForm } from './components/SetPasswordForm'
export { signInWithPassword, changePassword, signOut, type StepResult } from './api/session'
