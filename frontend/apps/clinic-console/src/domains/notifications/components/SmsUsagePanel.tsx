import { Card, DateTime, Notice } from '@carevelo/ui'
import type { Attempt } from '../api/http'
import type { SmsUsage } from '../api/types'

/**
 * How much SMS this clinic has used this month.
 *
 * ------------------------------------------------------------------
 * WHAT THIS PANEL IS CAREFUL NOT TO SAY
 *
 * Nothing here is a credit, a remaining amount or anything held on the clinic's behalf. SMS
 * is a metered pass-through invoiced by the gateway; the platform keeps no ledger and holds
 * nothing to draw down, so the only honest report is a count of the messages it recorded.
 * The endpoint happens to be named `/v1/sms-balance`, which is the contract's word and not
 * this product's — every label below says "used", "sent" or "suppressed", and the API's own
 * caveat is rendered verbatim underneath so the clinic reads it in the API's words as well
 * as ours.
 *
 * ------------------------------------------------------------------
 * WHY `suppressed` IS THE BIG NUMBER
 *
 * It is the one an administrator would never otherwise discover. A rate-limited message is
 * not a failure anyone is told about: the patient simply does not get their reminder, the
 * clinic sees nothing wrong, and the first symptom is people not turning up. Every other
 * figure on this panel is a count of things that happened; this is a count of things that
 * were meant to and did not.
 */
export function SmsUsagePanel({ usage }: { usage: Attempt<SmsUsage> }) {
  if (!usage.ok) {
    return (
      <Card as="section">
        <h2 className="title">Messages used this month</h2>
        <div style={{ marginTop: 'var(--space-4)' }}>
          {usage.status === 403 ? (
            <Notice tone="info" title="This is the clinic administrator’s view">
              <p>Ask your administrator if you need this month&rsquo;s message counts.</p>
            </Notice>
          ) : (
            <Notice tone="warn" title="The counts could not be loaded">
              <p>{usage.message ?? 'The request did not reach the API. Try again in a moment.'}</p>
            </Notice>
          )}
        </div>
      </Card>
    )
  }

  const value = usage.value

  return (
    <Card as="section">
      <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
        <h2 className="title">Messages used this month</h2>
        {value.periodStart === null ? null : (
          <span className="muted">
            {/*
             * A bare `YYYY-MM-DD` from the API, resolved in the CLINIC's timezone. Midnight
             * UTC is 03:00 the same morning in Africa/Kampala, so the rendered date is the
             * day the API meant; an earlier hour would roll it back a day for all of East
             * Africa.
             */}
            Since <DateTime value={`${value.periodStart}T00:00:00Z`} />
          </span>
        )}
      </div>

      {value.unreadable ? (
        /* A zero and "we could not read the figures" lead a clinic to do opposite things,
           and a zero is the more alarming of the two to be wrong about. */
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Notice tone="bad" title="The counts came back in an unexpected shape">
            <p>
              This console could not read this month&rsquo;s message counts. They are not zero
              — they are unknown.
            </p>
          </Notice>
        </div>
      ) : (
        <div className="grid g-3" style={{ marginTop: 'var(--space-5)' }}>
          <div className="stat">
            <span className="stat__label">Recorded this month</span>
            <span className="stat__value">{value.total ?? '—'}</span>
            <span className="stat__note">Every message, whatever became of it.</span>
          </div>

          {value.counts.map((entry) => (
            <div className="stat" key={entry.status}>
              <span className="stat__label">{entry.status}</span>
              <span className="stat__value">{entry.count}</span>
            </div>
          ))}

          <div className="stat">
            <span className="stat__label">Suppressed by the rate limit</span>
            <span className="stat__value">{value.suppressed ?? '—'}</span>
            <span className="stat__note">
              Meant to go out and did not. Nobody is told when this happens, which is why it
              is here.
            </span>
          </div>
        </div>
      )}

      {value.suppressed !== null && value.suppressed > 0 ? (
        <div style={{ marginTop: 'var(--space-5)' }}>
          <Notice tone="warn" title="Some messages did not go out">
            <p>
              {value.suppressed} message{value.suppressed === 1 ? '' : 's'} hit the per-clinic
              rate limit
              {value.perMinuteLimit === null ? '' : ` of ${value.perMinuteLimit} a minute`} and
              were not sent. Patients expecting a reminder did not get one.
            </p>
          </Notice>
        </div>
      ) : null}

      {value.note === '' ? null : (
        <p className="fine" style={{ marginTop: 'var(--space-5)' }}>
          {value.note}
        </p>
      )}
    </Card>
  )
}
