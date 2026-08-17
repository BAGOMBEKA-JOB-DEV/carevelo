/**
 * The identity domain's PUBLIC SURFACE.
 *
 * Signing in, signing out, and reading who the caller is. Everything else in this
 * folder is internal: the cookie-forwarding in api/session.ts is the kind of plumbing
 * that should have exactly one way in.
 */
export { SignInForm } from './components/SignInForm'
export { requestCode, verifyCode, signOut, type StepResult } from './api/session'
