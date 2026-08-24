import { Card, DateTime, Grid, Inline, Notice, Stack, Stat } from '@carevelo/ui'
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
        <Stack gap="4">
          <h2 className="title">Messages used this month</h2>

          {usage.status === 403 ? (
            <Notice tone="info" title="This is the clinic administrator’s view">
              <p>Ask your administrator if you need this month&rsquo;s message counts.</p>
            </Notice>
          ) : (
            <Notice tone="warn" title="The counts could not be loaded">
              <p>{usage.message ?? 'The request did not reach the API. Try again in a moment.'}</p>
            </Notice>
          )}
        </Stack>
      </Card>
    )
  }

  const value = usage.value

  return (
    <Card as="section">
      {/* One Stack for the whole panel. Six `marginTop`s stood here and they did not agree
          with each other — 12px above the unreadable notice, 16px above everything else —
          which is the signature of a space nobody decided. The column decides once. */}
      <Stack gap="5">
        <Inline justify="between">
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
        </Inline>

        {value.unreadable ? (
          /* A zero and "we could not read the figures" lead a clinic to do opposite things,
             and a zero is the more alarming of the two to be wrong about. */
          <Notice tone="bad" title="The counts came back in an unexpected shape">
            <p>
              This console could not read this month&rsquo;s message counts. They are not zero
              — they are unknown.
            </p>
          </Notice>
        ) : (
          <Grid cols={3}>
            {/* `<Stat>` rather than three hand-assembled spans: it puts the label before the
                value in the DOM by construction, which is the difference between a screen
                reader saying "Recorded this month, 412" and reading out a bare number with
                nothing attached to it. */}
            <Stat
              label="Recorded this month"
              value={value.total ?? '—'}
              note="Every message, whatever became of it."
            />

            {value.counts.map((entry) => (
              <Stat key={entry.status} label={entry.status} value={entry.count} />
            ))}

            <Stat
              label="Suppressed by the rate limit"
              value={value.suppressed ?? '—'}
              note="Meant to go out and did not. Nobody is told when this happens, which is why it is here."
            />
          </Grid>
        )}

        {value.suppressed !== null && value.suppressed > 0 ? (
          <Notice tone="warn" title="Some messages did not go out">
            <p>
              {value.suppressed} message{value.suppressed === 1 ? '' : 's'} hit the per-clinic
              rate limit
              {value.perMinuteLimit === null ? '' : ` of ${value.perMinuteLimit} a minute`} and
              were not sent. Patients expecting a reminder did not get one.
            </p>
          </Notice>
        ) : null}

        {value.note === '' ? null : <p className="fine">{value.note}</p>}
      </Stack>
    </Card>
  )
}
