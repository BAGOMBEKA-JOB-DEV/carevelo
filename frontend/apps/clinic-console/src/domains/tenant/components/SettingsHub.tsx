import { Card, Icon, Inline, Notice } from '@carevelo/ui'
import { attempt, tenantHost } from '../api/http'
import { getClinic } from '../api/clinic'
import type { TenantPaths } from '../model/types'
import { AccessNotice } from './AccessNotice'
import { OnboardingChecklist } from './OnboardingChecklist'
import { SUBDOMAIN_IS_FIXED, clinicName } from './screen'

/**
 * The settings landing screen: what remains, what this clinic is, and the way into
 * everything else.
 *
 * ------------------------------------------------------------------------------
 * THE CHECKLIST IS FIRST, AND IT IS FIRST ON PURPOSE.
 *
 * §K's target is first contact to first consultation in under a day, unassisted. That
 * number is only reachable if an administrator who comes back after lunch can see in one
 * glance what is left. A settings page that opened with a grid of equal-looking cards would
 * make them reconstruct it every time.
 *
 * ------------------------------------------------------------------------------
 * THE CLINIC'S ADDRESS IS SHOWN, AND SHOWN AS FIXED.
 *
 * §H1.1 and `identifiers-and-numbering.md`: the subdomain is immutable after provisioning,
 * and the UI must say so. `UpdateTenantRequest` declares it `prohibited` rather than
 * omitting it, so an attempt would come back with an explanation — but the better screen is
 * the one where the attempt is never invited. So it is rendered as a fact with the reason
 * beside it, and there is no input.
 *
 * IT COMES FROM THE REQUEST HOST, not from an endpoint, and that is a symptom rather than a
 * design: `subdomain` lives on `TenantAdminResource`, which nothing can fetch. See
 * `api/clinic.ts`. The host is the same value by definition — tenancy is resolved from it
 * and from nothing else — so what is shown is correct; it is just arrived at sideways.
 */

export type SettingsHubProps = {
  paths: TenantPaths
}

export async function SettingsHub({ paths }: SettingsHubProps) {
  const [result, host] = await Promise.all([attempt(getClinic()), tenantHost()])

  return (
    <div className="grid">
      <OnboardingChecklist paths={paths} />

      {!result.ok ? (
        <AccessNotice failure={result} context="this clinic's details" />
      ) : (
        <Card as="section">
          <span className="eyebrow">This clinic</span>
          <h2 className="title-sm">{clinicName(result.value)}</h2>

          <dl className="stack" style={{ gap: 'var(--space-4)', marginTop: 'var(--space-5)' }}>
            <div>
              <dt className="stat__label">Address</dt>
              <dd className="mono">{host}</dd>
            </div>
            <div>
              <dt className="stat__label">Time zone</dt>
              <dd className="stat__note">
                {result.value.timezone} — every time in Carevelo, on every screen and every
                receipt, is this one.
              </dd>
            </div>
            <div>
              <dt className="stat__label">Currency</dt>
              <dd className="stat__note">
                {result.value.currency}. Prices are set by this clinic; Carevelo publishes no
                price list and takes no share of a consultation fee.
              </dd>
            </div>
          </dl>

          <Notice tone="info" icon="lock" title="The address cannot be changed">
            {SUBDOMAIN_IS_FIXED}
          </Notice>
        </Card>
      )}

      <div className="grid g-2">
        {SECTIONS.map((section) => (
          <a
            key={section.key}
            className="card"
            href={section.href(paths)}
            style={{ display: 'block' }}
          >
            <Inline as="span" gap="3" wrap={false}>
              <Icon name={section.icon} />
              <strong>{section.title}</strong>
            </Inline>
            <p className="muted" style={{ marginTop: 'var(--space-3)' }}>
              {section.body}
            </p>
          </a>
        ))}
      </div>
    </div>
  )
}

/**
 * The five things a clinic configures, in the order §H1's main flow does them.
 *
 * NOT ALPHABETICAL AND NOT BY IMPORTANCE. Branding first because it is where an
 * administrator decides whether this product is credible; the payment connection last
 * because it is the one step that can be skipped entirely and the clinic still sees
 * patients. An order that put payments first would imply the opposite.
 */
const SECTIONS: readonly {
  key: string
  title: string
  body: string
  icon: 'heart' | 'shield' | 'file' | 'clock' | 'users' | 'coins'
  href: (paths: TenantPaths) => string
}[] = [
  {
    key: 'branding',
    title: 'Branding',
    body: 'Your name, your logo and your colours, with a preview of what your patients see.',
    icon: 'heart',
    href: (paths) => paths.branding,
  },
  {
    key: 'compliance',
    title: 'Clinic details and compliance',
    body: 'Contact details, and your licence references — recorded as your own attestation and not verified by Carevelo.',
    icon: 'shield',
    href: (paths) => paths.compliance,
  },
  {
    key: 'services',
    title: 'Services and prices',
    body: 'What this clinic offers, how long each takes, and what it costs in shillings.',
    icon: 'file',
    href: (paths) => paths.services,
  },
  {
    key: 'hours',
    title: 'Opening hours',
    body: 'The week. Appointment times are generated from this, so an empty week means an empty booking page.',
    icon: 'clock',
    href: (paths) => paths.hours,
  },
  {
    key: 'staff',
    title: 'Colleagues',
    body: 'Invitations, roles, and the registration details that make a clinician bookable.',
    icon: 'users',
    href: (paths) => paths.staff,
  },
  {
    key: 'payments',
    title: 'Taking payment',
    body: 'Connect your own mobile-money account — or do not, and take payment at the counter.',
    icon: 'coins',
    href: (paths) => paths.payments,
  },
]
