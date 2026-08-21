import { Badge, Card, DateTime, Notice } from '@carevelo/ui'
import { scopeLabel } from '../model/scopes'
import type { Grant } from '../model/types'

/**
 * One grant, rendered so that a reviewer months later can tell what happened without asking
 * anybody.
 *
 * ============================================================
 * THE STATE COMES FROM THE API, NOT FROM COMPARING CLOCKS HERE
 * ============================================================
 *
 * `has_expired` and `permits_access_now` are computed on the API at read time. This
 * component renders them and does not second-guess them with `new Date(expires_at) >
 * Date.now()`, for two reasons that matter more here than on an ordinary screen.
 *
 * First, the server's clock is the one the grant is actually enforced against. A browser
 * whose clock is four minutes fast would show a grant as expired while it was still letting
 * somebody read a clinic's records — the most misleading possible state for this particular
 * card.
 *
 * Second, `permits_access_now` is not merely "not yet expired": an unnotified grant permits
 * nothing regardless of its expiry, and only the API knows that. A client-side time
 * comparison would quietly report such a grant as live.
 *
 * ============================================================
 * NO COUNTDOWN, AND NO RELATIVE TIME
 * ============================================================
 *
 * "Expires in 43 minutes" needs JavaScript to stay true, and this surface ships none. A
 * relative time rendered once on the server is worse than an absolute one: it looks live and
 * ages silently, so an operator returning to a tab reads a number that was correct when the
 * page loaded and is not correct now. The absolute instant, in Africa/Kampala, is a fact
 * that does not go stale.
 *
 * ============================================================
 * THERE IS NO END-THIS-GRANT CONTROL, AND THAT IS NOT AN OVERSIGHT
 * ============================================================
 *
 * The published API has no revoke endpoint. Grants expire; the time box is the control. See
 * api/grants.ts for the whole of it. This card renders `revoked_at` when the API reports it,
 * because the field exists in the model, and offers nothing that would set it.
 */
export function GrantCard({
  grant,
  clinic,
}: {
  grant: Grant
  /** The clinic's trading name, where the register could supply one. */
  clinic?: string | undefined
}) {
  return (
    <Card as="article" padding="tight">
      <div className="stack" style={{ gap: 'var(--space-4)' }}>
        <div className="row-wrap">
          <div className="grow">
            <strong>{clinic ?? 'Clinic not on the loaded register'}</strong>
            <p className="fine">
              tenant <code>{grant.tenant_id}</code> · operator <code>{grant.operator_id}</code>
            </p>
          </div>
          <State grant={grant} />
        </div>

        <div className="row-wrap" style={{ gap: 'var(--space-7)' }}>
          <span className="stat">
            <span className="stat__label">Scope</span>
            <span className="stat__note">{scopeLabel(grant.scope)}</span>
          </span>
          <span className="stat">
            <span className="stat__label">Granted</span>
            <span className="stat__note">
              <DateTime value={grant.granted_at} format="datetime" />
            </span>
          </span>
          <span className="stat">
            <span className="stat__label">Expires</span>
            <span className="stat__note">
              <DateTime value={grant.expires_at} format="datetime" />
            </span>
          </span>
          {grant.revoked_at ? (
            <span className="stat">
              <span className="stat__label">Revoked</span>
              <span className="stat__note">
                <DateTime value={grant.revoked_at} format="datetime" />
              </span>
            </span>
          ) : null}
        </div>

        {/*
          THE REASON IS SHOWN VERBATIM AND IS NEVER SUMMARISED. It is the whole of what a
          later reviewer has to go on, and it was written by an operator who knew they would
          be read. Truncating it here would make the register look tidy and make the review
          impossible.
        */}
        <div className="stack">
          <span className="stat__label">Reason given</span>
          <p className="muted" style={{ whiteSpace: 'pre-wrap' }}>
            {grant.reason}
          </p>
        </div>

        {grant.tenant_notified_at ? (
          <p className="fine">
            Clinic notified <DateTime value={grant.tenant_notified_at} format="datetime" />. The
            clinic is the data controller and has a right to know when its processor reads its
            records; that notification is not a setting anyone can switch off.
          </p>
        ) : (
          /*
            The contract on this field: "Not decoration. An unnotified grant permits nothing,
            so this field is the difference between a request and a grant." A null here is
            therefore not a missing nicety — it is a grant that does not work, and the loudest
            thing on the card.
          */
          <Notice tone="bad" title="The clinic has not been recorded as notified">
            An unnotified grant permits nothing — the notification is what turns a request
            into a grant, and the API issues both in one transaction. A grant sitting here
            without one means something failed between them, and it is worth chasing rather
            than retrying: a second request would notify the clinic twice about one incident.
          </Notice>
        )}
      </div>
    </Card>
  )
}

/**
 * What this grant is doing right now, as a word.
 *
 * `permits_access_now` IS FIRST because it is the only question anyone is really asking of
 * this card. Live is amber and never green: a grant permitting a Carevelo operator into a
 * clinic's records is a working control and not a good state, and a green tick beside one
 * would say the opposite of everything else on this screen.
 */
function State({ grant }: { grant: Grant }) {
  if (grant.permits_access_now) {
    return (
      <Badge tone="warn" icon="lock">
        live now
      </Badge>
    )
  }

  if (grant.revoked_at) {
    return <Badge tone="neutral">revoked</Badge>
  }

  if (grant.has_expired) {
    return <Badge tone="neutral">expired</Badge>
  }

  // Not expired, not revoked, and still not permitting access — which on this resource means
  // the notification has not landed. Named rather than left blank, because a card with no
  // state on it reads as a rendering bug.
  return (
    <Badge tone="bad" icon="x">
      not in force
    </Badge>
  )
}
