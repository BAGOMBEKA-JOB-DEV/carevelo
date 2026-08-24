import { redirect } from 'next/navigation'
import { Badge, Button, Card, Notice, PageHeader, Stack } from '@carevelo/ui'
import { signOut } from '../api/signIn'
import type { Operator } from '../model/roles'
import type { IdentityPaths } from '../model/signIn'

/**
 * Signed in, and holding no platform role.
 *
 * ============================================================
 * THE GUEST HALF OF THIS COMPONENT IS GONE, AND ITS ARGUMENT IS NOT
 * ============================================================
 *
 * This file used to carry a second branch, for a request with no session at all, whose
 * whole content was a case AGAINST building the screen that now exists. It said that
 * `docs/40-api/openapi.yaml` published no TOTP enrolment or challenge endpoint, that a
 * password form built here would therefore authenticate the highest-privilege session in
 * the product — the one that can authorise a break-glass grant into a clinic's records —
 * with one factor while looking compliant, and that a sign-in bound to a tenant resolved
 * from the host had no meaning on `admin.carevelo.app`, which resolves to no tenant.
 *
 * Both of those are now closed on the API, and `SignInScreen` is the screen that branch
 * said should exist "when the contract grows TOTP enrolment and challenge endpoints and
 * states how a platform session is bound". It has not been softened into existence: the
 * password step opens no session at all, `RequireSecondFactor` guards every route in the
 * platform group, and a platform session binds no tenant because a platform account has
 * none. `SignInScreen`'s own docblock restates the argument in full, because it is the bar
 * that screen has to keep clearing.
 *
 * What remains here is the `no-role` case, which is a genuinely different answer and must
 * not be flattened into either a sign-in prompt or a 404. It says the browser HAS a
 * session and this account may not use this surface.
 *
 * @see docs/50-security-compliance/rbac-matrix.md § Administration
 */
export type AccessNoticeProps = {
  /** The account that is signed in. Named on screen — see below. */
  operator: Operator
  paths: IdentityPaths
}

export function AccessNotice({ operator, paths }: AccessNoticeProps) {
  /*
   * Sign out, then back to the sign-in screen.
   *
   * THIS SCREEN IS WHERE THE CONTROL BELONGS, and it was missing. The commonest cause of
   * landing here is a person signed in with the wrong account on a shared machine — a
   * clinic administrator's session in the browser somebody then opened the platform console
   * in — and the honest response to "you cannot use this" is a way to stop being that
   * account. Without it the only exit is clearing cookies by hand or waiting out the
   * fifteen-minute idle timeout, on a screen that has just told the operator they are
   * blocked.
   */
  async function leave() {
    'use server'

    await signOut()

    return redirect(paths.signIn)
  }

  return (
    <>
      <PageHeader
        title="No platform role"
        description={
          'This account is signed in and holds no platform role, so none of the control '
          + 'plane is available to it.'
        }
        actions={<Badge tone="warn">Refused</Badge>}
      />

      <Stack gap="6">
        {/*
          * NAMES THE ACCOUNT, deliberately. The commonest cause is a person signed in with
          * the wrong one on a shared machine, and a message that will not say which account
          * leaves them with nothing to act on. It discloses nothing: they are already
          * holding that session.
          */}
        <Notice tone="info" icon="user" title={`Signed in as ${operator.name}`}>
          Roles on this account:{' '}
          {operator.roles.length > 0 ? operator.roles.join(', ') : 'none'}. The control plane
          needs <code>platform_support</code> or <code>platform_admin</code>.
        </Notice>

        <Card as="section">
          <Stack gap="4">
            <h2>This is not a mistake you can fix from here</h2>
            <p className="muted">
              Platform roles are not self-assigned and there is no request-access control on
              this screen, deliberately: the register of clinics and the break-glass grant
              are the two most consequential surfaces Carevelo operates, and a button that
              starts an escalation from inside them is a button worth phishing. Ask an
              existing platform administrator out of band.
            </p>

            <form action={leave}>
              <Button type="submit" variant="quiet">
                Sign out and use a different account
              </Button>
            </form>
          </Stack>
        </Card>
      </Stack>
    </>
  )
}
