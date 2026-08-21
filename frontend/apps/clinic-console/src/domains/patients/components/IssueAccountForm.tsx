'use client'

import type { ReactElement } from 'react'
import { useActionState } from 'react'
import { Button, Icon, Notice } from '@carevelo/ui'

/**
 * The one 'use client' in this domain, and the reason is a security requirement rather than a
 * convenience.
 *
 * ==========================================================================
 * WHY THIS CANNOT BE A SERVER COMPONENT WITH A REDIRECT.
 * ==========================================================================
 *
 * The API generates the password and returns it in the 201 body. That body is the ONLY place
 * the plaintext ever exists — it is stored as a hash, it is in no audit event, no log line and
 * no notification, and there is no endpoint that can produce it again. So it has to be rendered
 * out of the response that created it, in that same request, and never carried anywhere.
 *
 * Every other form in this domain is a Server Action that ends in `redirect()`, which is the
 * right shape when the outcome is "it worked, go and look". It is exactly the wrong shape here,
 * because a redirect can only carry a value in one of two places and both are disqualified:
 *
 *   - THE URL. A password in a query string lands in browser history on a SHARED front-desk
 *     terminal, in the console's own access logs, in any proxy in front of it, and in the
 *     Referer header of the next request. That is four copies of a credential whose entire
 *     design is that there is one.
 *   - A COOKIE. It would then be sent back to the server with every subsequent request until
 *     something deleted it, and would sit in the browser's cookie jar in the meantime.
 *
 * `useActionState` is the remaining option: the action's return value becomes render state
 * without a navigation. The password reaches the browser once, in the response body of the POST
 * that minted it, and lives only in this component's state. Closing or reloading the page
 * loses it — which is correct, and is what the copy says.
 *
 * IT STILL WORKS WITHOUT JAVASCRIPT. A form whose action came from `useActionState` submits
 * natively before hydration, and React renders the returned state on the server response. That
 * matters on a front-desk terminal on a bad line: a receptionist who has already told the
 * patient an account is coming should not be stopped by a bundle that has not arrived.
 *
 * ==========================================================================
 * WHAT THIS COMPONENT IS NOT ALLOWED TO GROW.
 * ==========================================================================
 *
 * No "email it to the patient". No "send by SMS". No copy-to-clipboard that writes the value
 * anywhere but the clipboard, and no "show again" — there is nothing to show again. SMS
 * transits the mobile operator and lands on a lock screen, and the notification channels in
 * this product are documented as untrusted transports that never carry anything of this kind.
 * The password is spoken, once, across a counter.
 *
 * @see api/account.ts — the endpoint, and the three refusals a desk actually meets
 */

/**
 * What the action did, as render state.
 *
 * A DISCRIMINATED UNION so `password` is unreachable on any arm but the successful one. On this
 * screen a `password?: string` would compile perfectly while rendering the word `undefined` in
 * the place a member of staff is about to read a credential aloud from.
 */
export type IssueAccountState =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'issued'
      readonly email: string
      /** Shown once. Never logged, never stored, never recoverable. */
      readonly password: string
    }
  | { readonly kind: 'refused'; readonly message: string }

export function IssueAccountForm({
  action,
  email,
  patientName,
  recordHref,
}: {
  /** A Server Action, bound to this patient and this address before it crossed over. */
  action: (state: IssueAccountState, formData: FormData) => Promise<IssueAccountState>
  /** The address on the record. Displayed, not editable — see `IssueAccountScreen`. */
  email: string
  patientName: string
  /** Plain strings only across this boundary; the paths object holds functions. */
  recordHref: string
}): ReactElement {
  const [state, formAction, pending] = useActionState<IssueAccountState, FormData>(action, {
    kind: 'idle',
  })

  if (state.kind === 'issued') {
    return (
      <div className="grid">
        <Notice tone="warn" icon="lock" announce title="Read this to the patient now">
          <p>
            This is the only time it will ever be shown. It is not stored anywhere in readable
            form, it is in no log and no message, and nobody — not an administrator, not
            Carevelo — can produce it again. If it is lost, {patientName} would need a different
            account against a different address.
          </p>
        </Notice>

        <div className="card stack">
          <span className="field__label">Signs in with</span>
          <p className="tnum" style={{ fontSize: 17, wordBreak: 'break-all' }}>
            {state.email}
          </p>

          <span className="field__label" style={{ marginTop: 'var(--space-5)' }}>
            Initial password
          </span>
          {/*
            Large, monospaced and unbroken. This string is read ALOUD to somebody across a
            counter, so the two failures that matter are a misread character and a line wrap in
            the middle of a word. `--mono` disambiguates the glyphs a proportional face runs
            together; `word-break: break-all` on the address above is right for an email and
            deliberately absent here.
          */}
          <p
            className="mono"
            style={{
              fontSize: 26,
              fontWeight: 700,
              letterSpacing: '0.04em',
              padding: 'var(--space-5)',
              borderRadius: 'var(--r-md)',
              background: 'var(--surface-sunken)',
              userSelect: 'all',
            }}
          >
            {state.password}
          </p>

          <p className="muted" style={{ marginTop: 'var(--space-4)' }}>
            Tell them they must change it the first time they sign in — until they do, their
            account can do nothing else. That is deliberate: while you know this password you
            could sign in as them, and the audit trail would name them rather than you.
          </p>
        </div>

        <div className="row-wrap">
          <Button href={recordHref} variant="primary">
            Done — back to the record
          </Button>
        </div>

        <p className="fine">
          Leaving this page loses the password. There is no way back to it.
        </p>
      </div>
    )
  }

  return (
    <form action={formAction} className="grid">
      {state.kind === 'refused' ? (
        <Notice tone="bad" announce title="No account was created">
          {state.message}
        </Notice>
      ) : null}

      <div className="card stack">
        <span className="field__label">The patient will sign in with</span>
        <p className="tnum" style={{ fontSize: 17, wordBreak: 'break-all' }}>
          {email}
        </p>
        <p className="muted">
          Taken from the record, and not editable here. If it is wrong, correct the record —
          one spelling of a patient’s address, in one place.
        </p>

        {/*
          A plain checkbox rather than <Choice>: this is a single condition that must be true
          before the button means anything, not one option among several. `required` makes it a
          condition rather than a suggestion and works with no JavaScript.

          SAID PLAINLY: this tick is stored nowhere. What IS recorded is the audit event naming
          you as the person who issued the account. The tick is here to stop a reflexive click
          on the one action in this product that produces somebody else's credential.
        */}
        <label
          className="row"
          htmlFor="identity-attested"
          style={{ marginTop: 'var(--space-5)' }}
        >
          <input
            className="choice__input"
            id="identity-attested"
            name="attested"
            type="checkbox"
            value="yes"
            required
          />
          <span className="choice__text">
            <span>
              {patientName} is in front of me and I have checked their identity document.
            </span>
          </span>
        </label>
      </div>

      <div className="row-wrap">
        <Button type="submit" variant="primary" disabled={pending}>
          <Icon name="lock" /> {pending ? 'Creating the account…' : 'Create the account'}
        </Button>
        <Button href={recordHref} variant="quiet">
          Cancel
        </Button>
      </div>
    </form>
  )
}
