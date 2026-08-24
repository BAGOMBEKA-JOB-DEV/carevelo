import { Badge, Card, Notice, PageHeader, Stack } from '@carevelo/ui'
import type { Access } from '../model/roles'

/**
 * What this surface shows to somebody it cannot let in.
 *
 * ============================================================
 * THERE IS NO SIGN-IN FORM HERE, AND ITS ABSENCE IS THE DESIGN
 * ============================================================
 *
 * Every other surface in this product signs a person in with an identifier and a
 * password. This one deliberately does not, and it would be straightforward to add —
 * `POST /v1/auth/sign-in` exists, the patient portal's identity domain is thirty lines of
 * proven code, and copying it here would make this app look finished this afternoon.
 *
 * That is exactly why it is not here. Two things in the published contract are missing,
 * and a password form would paper over both while appearing to satisfy them.
 *
 * ---- 1. The second factor is MANDATORY and has no endpoint ----
 *
 * docs/40-api/authentication-and-sessions.md § Second factor: "Mandatory for platform
 * operators... TOTP, and only TOTP. There is no SMS fallback... For a platform operator,
 * TOTP is required rather than offered." Acceptance criterion 5 of that document states
 * it as a testable rule: "Platform operators cannot authenticate without a second
 * factor."
 *
 * docs/40-api/openapi.yaml publishes `/v1/auth/sign-in`, `/v1/auth/sign-out`, `/v1/me` and
 * `/v1/me/password`. There is no enrolment endpoint, no challenge endpoint and no field on
 * the sign-in request for a code. So a sign-in form built here today would authenticate a
 * platform operator with a password alone — the single highest-value session in the
 * product, the one that can authorise a break-glass grant into a clinic's records — while
 * the screen looked like the compliant thing.
 *
 * A convincing sign-in form that silently drops a required control is worse than no form.
 * It is the same failure this codebase has already found twice: a scheduled command that
 * was never scheduled, and a Content Security Policy that read as maximally strict and was
 * switched off.
 *
 * ---- 2. Sign-in resolves a TENANT from the host, and this host is not one ----
 *
 * Same document, § Tenant binding: "Every session is bound to exactly one tenant, resolved
 * at sign-in", and "A session's tenant is checked against the host on every request. A
 * mismatch is a hard 403 and an AuditEvent." The sign-in flow compares the password
 * "against the account at the resolved tenant".
 *
 * This app is served from `admin.carevelo.app`, which resolves no tenant. There is
 * therefore no described way for a platform operator to obtain a session AT ALL, on this
 * host or any other — a platform account has no tenant to be bound to, and signing in on
 * some clinic's subdomain to get a cross-tenant session would be the mismatch the same
 * document defines as an attack.
 *
 * ---- What this screen does instead ----
 *
 * It says both of those, in the product, to the person who hit the wall. The alternative
 * is a form that fails in a way nobody can interpret, or worse, one that succeeds.
 *
 * When the contract grows TOTP enrolment and challenge endpoints and states how a platform
 * session is bound, the sign-in screen belongs in this domain beside `api/session.ts`,
 * and this component keeps the `no-role` half.
 */
export function AccessNotice({ access }: { access: Access }) {
  if (access.kind === 'guest') {
    return (
      <>
        <PageHeader
          title="Not signed in"
          description={
            'This surface is behind authentication and has no sign-in form. That is '
            + 'deliberate, and the reason is worth reading before anyone adds one.'
          }
          actions={<Badge tone="warn">No session</Badge>}
        />

        <Stack gap="6">
          <Notice tone="warn" icon="lock" title="A platform operator cannot sign in yet">
            The published API has no way to authenticate one. Mandatory TOTP is specified
            for platform roles and no enrolment or challenge endpoint exists; and every
            session is bound to a tenant resolved from the host, which
            <code> admin.carevelo.app </code>
            is not. Both are gaps in the contract rather than in this app.
          </Notice>

          <Card as="section">
            <Stack gap="4">
              <h2>Why there is no password form here</h2>
              <p className="muted">
                Building one would take an afternoon and would authenticate the
                highest-privilege session in the product — the one that can authorise a
                break-glass grant into a clinic&rsquo;s records — with a password alone,
                while the screen looked like the compliant thing. A control that is
                specified as mandatory and quietly absent is worse than one that is
                visibly missing: nobody goes looking for it.
              </p>
              <p className="muted">
                Authentication and sessions, § Second factor, states it as a testable
                rule: platform operators cannot authenticate without a second factor.
                Until the API can enforce that, this screen is the honest state of the
                system.
              </p>
            </Stack>
          </Card>

          <Card as="section">
            <Stack gap="4">
              <h2>What has to arrive first</h2>
              {/* `Stack as="ul"` strips the user-agent's markers and its 40px indent AND
                  restores `role="list"` — Safari drops list semantics from an element whose
                  `list-style` is `none`, so removing the bullet without putting the role
                  back is how a list of three prerequisites stops being announced as three
                  of anything. That is the whole reason this is not a `<ul>` with a
                  hand-set `paddingLeft`, which is what it was. */}
              <Stack as="ul" gap="3" className="muted">
                <li>TOTP enrolment and challenge endpoints, with no SMS fallback.</li>
                <li>
                  A stated binding for a platform session, since a platform account belongs
                  to no tenant and the host it signs in on cannot supply one.
                </li>
                <li>
                  A recorded out-of-band recovery path for an operator who loses their
                  authenticator, which the same document already requires.
                </li>
              </Stack>
            </Stack>
          </Card>
        </Stack>
      </>
    )
  }

  /*
   * Signed in, and not a platform operator.
   *
   * This says which account it is, because the commonest cause is a person signed in with
   * the wrong one on a shared machine, and a message that will not name the account leaves
   * them with nothing to act on. It discloses nothing: they are already holding that
   * session.
   */
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
        <Notice tone="info" icon="user" title={`Signed in as ${access.operator.name}`}>
          Roles on this account:{' '}
          {access.operator.roles.length > 0 ? access.operator.roles.join(', ') : 'none'}. The
          control plane needs <code>platform_support</code> or <code>platform_admin</code>.
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
          </Stack>
        </Card>
      </Stack>
    </>
  )
}
