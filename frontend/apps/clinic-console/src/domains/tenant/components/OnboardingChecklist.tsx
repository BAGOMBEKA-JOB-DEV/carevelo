import { Badge, Card, Icon, Notice } from '@carevelo/ui'
import { attempt } from '../api/http'
import { getChecklist } from '../api/clinic'
import type { ChecklistItem, TenantPaths } from '../model/types'
import { AccessNotice } from './AccessNotice'

/**
 * What remains before the clinic is live.
 *
 * ------------------------------------------------------------------------------
 * PERSISTENT, WHICH IS THE POINT.
 *
 * §H1.8 asks for a checklist that is always there rather than a wizard that runs once. The
 * difference is the difference between a clinic that abandons onboarding halfway and one
 * that comes back to it after lunch: a wizard has a place you fall out of, a checklist has
 * a place you return to. So every settings screen in this domain renders one of these at
 * the top, and the hub renders it in full.
 *
 * ------------------------------------------------------------------------------
 * THE AGGREGATOR LINE IS OPTIONAL AND MUST LOOK OPTIONAL.
 *
 * `is_required` comes from the API and the aggregator account is deliberately not among
 * the four gates. §H1.6: a clinic without a merchant account completes onboarding, runs
 * consultations, and takes payment at the counter. Rendering every line identically would
 * turn a commercial gap into what looks like a clinical blocker — so an optional line that
 * is not done says "Optional", in a word, rather than in a colour.
 *
 * NOTHING HERE IS COMPUTED LOCALLY. Which gates are required, and whether each is
 * satisfied, is `TenantAdminController::checklistItems()`'s decision — it reads through the
 * same queries the rest of the application does, so the checklist cannot claim a
 * connection the collection code would refuse. A second opinion in TypeScript would be a
 * checklist that ticks a box the backend does not.
 *
 * ------------------------------------------------------------------------------
 * A FAILED FETCH IS NOT A BLOCKED SCREEN.
 *
 * This component fetches for itself and returns a notice on failure rather than throwing.
 * It is mounted at the top of every settings screen, so an exception here would take down
 * the branding editor, the staff list and the payment connection at once — and a clinic
 * mid-onboarding would see the framework's error boundary instead of the product.
 */

export type OnboardingChecklistProps = {
  paths: TenantPaths
  /** The compact strip at the top of a sub-screen, rather than the full panel on the hub. */
  compact?: boolean | undefined
}

export async function OnboardingChecklist({ paths, compact = false }: OnboardingChecklistProps) {
  const result = await attempt(getChecklist())

  if (!result.ok) {
    // Compact mode is a strip on somebody else's screen. A failure there is worth one
    // quiet line, not a panel explaining an outage on a page about opening hours.
    if (compact) {
      return null
    }

    return <AccessNotice failure={result} context="the onboarding checklist" />
  }

  const checklist = result.value
  const outstanding = checklist.items.filter((item) => item.is_required && !item.is_complete)
  const done = checklist.items.filter((item) => item.is_complete).length

  if (compact) {
    return (
      <Notice
        tone={checklist.is_ready_to_activate ? 'info' : 'warn'}
        icon={checklist.is_ready_to_activate ? 'check' : 'activity'}
      >
        <p>
          <strong>
            {done} of {checklist.items.length} set up.
          </strong>{' '}
          {checklist.is_ready_to_activate
            ? 'Everything required to see patients is in place.'
            : `Still needed: ${outstanding.map((item) => item.label).join('; ')}.`}{' '}
          <a className="lnk" href={paths.hub}>
            Open the checklist
          </a>
        </p>
      </Notice>
    )
  }

  return (
    <Card as="section">
      <div className="row between">
        <div className="grow">
          <span className="eyebrow">Onboarding</span>
          <h2 className="title-sm">Getting this clinic ready</h2>
        </div>
        <Badge tone={checklist.is_ready_to_activate ? 'good' : 'warn'}>
          {checklist.is_ready_to_activate ? 'Ready to see patients' : 'In progress'}
        </Badge>
      </div>

      <ul className="stack" style={{ gap: 'var(--space-4)', marginTop: 'var(--space-6)' }}>
        {checklist.items.map((item) => (
          <ChecklistLine key={item.key} item={item} href={hrefFor(item.key, paths)} />
        ))}
      </ul>

      {/*
       * The API's own sentence about the aggregator, verbatim. It is the one line that
       * stops an administrator reading an untick as a stop sign, and it belongs to the
       * backend rather than to this component — the checklist and the payment path must
       * not be able to disagree about whether care is blocked.
       */}
      {checklist.note === '' ? null : (
        <p className="fine" style={{ marginTop: 'var(--space-6)' }}>
          {checklist.note}
        </p>
      )}

      <p className="fine">
        This clinic is currently <strong>{checklist.tenant_status}</strong>. The status follows
        from onboarding; it is never set by hand.
      </p>
    </Card>
  )
}

/**
 * One line.
 *
 * `aria-hidden` on the tick and a WORD beside it, always. The badge convention in
 * components.css exists because a coloured dot is unreadable to a colour-blind
 * administrator and invisible to a screen reader — and this list is the one place in the
 * product where the difference between done and not done decides whether a clinic can see
 * patients today.
 */
function ChecklistLine({ item, href }: { item: ChecklistItem; href: string | null }) {
  return (
    <li className="row" style={{ alignItems: 'flex-start' }}>
      <span aria-hidden="true" style={{ marginTop: 2 }}>
        {item.is_complete ? <Icon name="check" /> : <Icon name="clock" />}
      </span>

      <span className="grow stack">
        <span className="row-wrap" style={{ gap: 'var(--space-3)' }}>
          {href === null ? (
            <span>{item.label}</span>
          ) : (
            <a className="lnk" href={href}>
              {item.label}
            </a>
          )}

          {item.is_complete ? (
            <Badge tone="good">Done</Badge>
          ) : item.is_required ? (
            <Badge tone="warn">Still needed</Badge>
          ) : (
            <Badge tone="neutral">Optional</Badge>
          )}
        </span>

        {item.detail === null ? null : <span className="fine">{item.detail}</span>}
      </span>
    </li>
  )
}

/**
 * Where a line leads.
 *
 * KEYED ON THE API'S OWN `key`, and an unknown key gets no link rather than a guess. The
 * checklist is the backend's list and it may grow — an eighth item added there should
 * appear here as an honest line with no link, not as a link to a page that does not exist.
 * `consent_templates` deliberately has none: the wording is platform-provided and
 * versioned, so there is nothing on this console to open.
 */
function hrefFor(key: string, paths: TenantPaths): string | null {
  switch (key) {
    case 'branding':
      return paths.branding
    case 'services':
      return paths.services
    case 'clinicians':
    case 'staff':
      return paths.staff
    case 'compliance_references':
      return paths.compliance
    case 'aggregator_account':
      return paths.payments
    default:
      return null
  }
}
