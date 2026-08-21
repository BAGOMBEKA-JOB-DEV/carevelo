import { Badge, Card, Notice } from '@carevelo/ui'
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
      <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
        <h2 className="title">Every message we can send</h2>
        <Badge tone="neutral">Read-only</Badge>
      </div>

      <p className="muted" style={{ marginTop: 'var(--space-2)' }}>
        This list cannot be edited, by your clinic or by Carevelo. Each message is checked
        against a prohibited-content list before it ships, and a message anyone could rewrite
        would be a message nobody had checked.
      </p>

      {catalogue.ok ? (
        <Entries catalogue={catalogue.value} />
      ) : (
        <div style={{ marginTop: 'var(--space-5)' }}>
          {catalogue.status === 403 ? (
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
        </div>
      )}
    </Card>
  )
}

function Entries({ catalogue }: { catalogue: Catalogue }) {
  return (
    <>
      {catalogue.unreadable > 0 ? (
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Notice tone="warn" title="Part of the catalogue could not be read">
            <p>
              {catalogue.unreadable} entr{catalogue.unreadable === 1 ? 'y is' : 'ies are'} missing
              from the list below because {catalogue.unreadable === 1 ? 'it' : 'they'} came back
              in a shape this console did not recognise. The list is not complete.
            </p>
          </Notice>
        </div>
      ) : null}

      <div className="grid g-2" style={{ marginTop: 'var(--space-5)' }}>
        {catalogue.templates.map((template) => (
          <div className="card stack" key={template.key}>
            <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
              <strong className="mono">{template.key}</strong>
              {template.isCritical ? (
                /* A permanent failure on one of these is surfaced to staff rather than
                   swallowed, so it is worth marking here too. */
                <Badge tone="warn">Failure is reported to staff</Badge>
              ) : null}
            </div>

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
          </div>
        ))}
      </div>

      {catalogue.note === '' ? null : (
        <p className="fine" style={{ marginTop: 'var(--space-5)' }}>
          {catalogue.note}
        </p>
      )}
    </>
  )
}
