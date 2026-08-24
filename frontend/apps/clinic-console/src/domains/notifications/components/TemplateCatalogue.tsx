import { Badge, Card, EmptyState, Grid, Inline, Notice, Stack } from '@carevelo/ui'
import type { Attempt } from '../api/http'
import type { TemplateCatalogue as Catalogue } from '../api/notifications'

/**
 * Every message this platform is capable of sending, patterns included.
 *
 * ------------------------------------------------------------------
 * READ-ONLY, AND THERE IS NO EDITOR COMING
 *
 * `GET /v1/notification-templates` is the only verb on that path. There is no PUT, no POST
 * and no plan for one: every template is asserted against a prohibited-content list before
 * it can ship, and an editable template is an unreviewed template. A clinic that could type
 * its own SMS body could put a diagnosis in it, and that message would land on a lock screen
 * having crossed a mobile operator.
 *
 * So this screen has no form, no "customise" button and no disabled control implying one is
 * coming. It says plainly why the list cannot be edited, because a clinic that does not know
 * why will ask, repeatedly.
 *
 * ------------------------------------------------------------------
 * WHY SHOW THE PATTERNS AT ALL
 *
 * Because the clinic is the data controller and is entitled to see exactly what goes out
 * under its own sender ID. It is also the only practical review surface for the content
 * rule: the catalogue is short enough for a person to read, which is the only reason that
 * rule can be checked by a human rather than trusted.
 */
export function TemplateCatalogue({ catalogue }: { catalogue: Attempt<Catalogue> }) {
  return (
    <Card as="section">
      {/* One Stack owns the card's rhythm. Five `marginTop`s lived here, each stating the
          space BELOW the element above it, which is a property of the column and not of any
          of them — and they disagreed: 12px above the unreadable notice, 16px above the
          grid and the footnote. Nobody chose that difference and nothing reads better for
          it, so the column states 16px once. */}
      <Stack gap="5">
        {/* The heading and its paragraph are one block at the tighter step, so the badge
            still sits on the heading's own line rather than being centred against the
            paragraph as well. */}
        <Stack gap="2">
          <Inline justify="between">
            <h2 className="title">Every message we can send</h2>
            <Badge tone="neutral">Read-only</Badge>
          </Inline>

          <p className="muted">
            This list cannot be edited, by your clinic or by Carevelo. Each message is checked
            against a prohibited-content list before it ships, and a message anyone could rewrite
            would be a message nobody had checked.
          </p>
        </Stack>

        {catalogue.ok ? (
          <Entries catalogue={catalogue.value} />
        ) : catalogue.status === 403 ? (
          <Notice tone="info" title="The catalogue is the clinic administrator’s view">
            <p>It is part of the clinic&rsquo;s own configuration surface.</p>
          </Notice>
        ) : (
          <Notice tone="warn" title="The catalogue could not be loaded">
            <p>
              {catalogue.message ?? 'The request did not reach the API. Try again in a moment.'}
            </p>
          </Notice>
        )}
      </Stack>
    </Card>
  )
}

function Entries({ catalogue }: { catalogue: Catalogue }) {
  return (
    <>
      {catalogue.unreadable > 0 ? (
        <Notice tone="warn" title="Part of the catalogue could not be read">
          <p>
            {catalogue.unreadable} entr{catalogue.unreadable === 1 ? 'y is' : 'ies are'} missing
            from the list below because {catalogue.unreadable === 1 ? 'it' : 'they'} came back
            in a shape this console did not recognise. The list is not complete.
          </p>
        </Notice>
      ) : null}

      {/* A REAL EMPTY STATE RATHER THAN AN EMPTY GRID. The catalogue is a closed list served
          by the platform, so nothing an administrator does can empty it — which is exactly
          why a blank panel here would be read as "still loading" and waited on. If this ever
          renders, the read succeeded and returned nothing, and that is a platform fault to
          report rather than anything the clinic can act on. Say so. */}
      {catalogue.templates.length === 0 ? (
        <EmptyState icon="mail" title="No messages are configured for this platform">
          The catalogue was read and came back with nothing in it. Nothing your clinic can do
          will change that — the list is the platform&rsquo;s and is the same for everyone —
          so this is worth reporting to Carevelo rather than waiting on. Messages the clinic
          has already sent are unaffected and still listed above.
        </EmptyState>
      ) : (
        <Grid cols={2}>
          {catalogue.templates.map((template) => (
            <Card key={template.key}>
              {/* `card stack` before this: the card WAS the flex column, at the reset's 6px.
                  Same 6px, said on the Stack, where the value is on the page. */}
              <Stack gap="2">
                <Inline justify="between">
                  <strong className="mono">{template.key}</strong>
                  {template.isCritical ? (
                    /* A permanent failure on one of these is surfaced to staff rather than
                       swallowed, so it is worth marking here too. */
                    <Badge tone="warn">Failure is reported to staff</Badge>
                  ) : null}
                </Inline>

                <p>{template.body}</p>

                <p className="fine">
                  {template.channels.length === 0
                    ? 'No channel recorded'
                    : `Sent by ${template.channels.join(' and ')}`}
                  {template.placeholders.length === 0
                    ? ''
                    : ` · fills in ${template.placeholders.join(', ')}`}
                  {template.permitsLink ? ' · may carry a sign-in link' : ''}
                </p>
              </Stack>
            </Card>
          ))}
        </Grid>
      )}

      {catalogue.note === '' ? null : <p className="fine">{catalogue.note}</p>}
    </>
  )
}
