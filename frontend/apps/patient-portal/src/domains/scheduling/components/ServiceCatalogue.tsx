import { getTranslations } from 'next-intl/server'
import { Badge, Button, Card, EmptyState, Icon, Money, Notice } from '@carevelo/ui'
import type { Tenant } from '@/lib/tenant'
import { listServices } from '../api/catalogue'
import { attempt } from '../api/http'
import { href } from '../model/links'
import { bookableModes } from '../model/slots'
import type { SchedulingPaths } from '../model/types'
import { modeText } from './strings'

/**
 * BROWSE: what the clinic offers, and what it costs.
 *
 * A SERVER COMPONENT THAT SHIPS NO JAVASCRIPT. Every price, every mode badge and every
 * "Choose a time" is markup by the time it leaves the server, and the link is an anchor
 * so it works with the bundle still in flight — which is the state a mid-range Android on
 * variable mobile data spends most of its first few seconds in.
 *
 * PRICES ARE THE CLINIC'S OWN AND SAY SO. Carevelo publishes no price list, recommends no
 * fee and takes no margin: a clinic in Gulu charging 20,000 for a follow-up and one in
 * Kampala charging 60,000 are both correctly configured. `<Money>` renders the amount
 * exactly as the backend's own `Money::format()` does — UGX with no decimal point,
 * truncated rather than rounded — so this page and a receipt printed at the desk cannot
 * disagree by a shilling.
 *
 * THE MODES ARE BADGES OF EQUAL WEIGHT. Voice and chat sit beside video in the same pill,
 * in the same colour, in the enum's own order. A patient who knows their connection will
 * not carry video needs to see that voice is a way to be seen, not a way video failed.
 *
 * DEACTIVATED SERVICES ARE FILTERED BY THE API, NOT HERE. `ServiceController` scopes a
 * patient's copy of the catalogue to `is_active`, because a withdrawn service is one a
 * patient could otherwise book and then travel to the clinic for. Repeating the rule here
 * would be a second copy of it, free to disagree.
 */
export async function ServiceCatalogue({
  tenant,
  paths,
}: {
  tenant: Tenant
  paths: SchedulingPaths
}) {
  const [t, common, modes] = await Promise.all([
    getTranslations('Scheduling'),
    getTranslations('Common'),
    modeText(),
  ])

  const clinic = tenant.trading_name ?? common('thisClinic')
  const phone = tenant.contact?.phone
  const loaded = await attempt(listServices())

  return (
    <div className="site-wrap" style={{ paddingBlock: 'var(--space-8)' }}>
      <div className="page-head">
        <div style={{ flex: '1 1 auto' }}>
          <span className="site-eyebrow">{t('catalogue.eyebrow')}</span>
          <h1 style={{ marginTop: 'var(--space-4)' }}>{t('catalogue.title')}</h1>
          <p>{t('catalogue.lede', { clinic })}</p>
        </div>
      </div>

      {!loaded.ok ? (
        /* The API's own sentence where it gave one, and our own where the request never
           arrived — see `attempt()`. What this must NOT say is that the clinic has no
           services, which is what an empty state here would tell a patient. */
        <Notice tone="bad" title={t('catalogue.unavailableTitle')}>
          {loaded.message ?? t('catalogue.unavailableGeneric', { clinic })}
          {' '}
          {t('catalogue.unavailableBody')}
        </Notice>
      ) : loaded.value.length === 0 ? (
        <EmptyState icon="calendar" title={t('catalogue.emptyTitle')}>
          {phone
            ? t('catalogue.emptyBodyWithPhone', { clinic, phone })
            : t('catalogue.emptyBody', { clinic })}
        </EmptyState>
      ) : (
        /* A list, because it is one: a screen reader is told how many services there are
           before it starts reading them, which is the difference between choosing and
           discovering. `Card as="li"` is why that element prop exists. */
        <ul className="stack" style={{ gap: 'var(--space-5)' }}>
          {loaded.value.map((service) => (
            <Card as="li" key={service.id}>
              <div
                className="row-wrap between"
                style={{ alignItems: 'flex-start', gap: 'var(--space-6)' }}
              >
                <div className="stack grow" style={{ gap: 'var(--space-3)' }}>
                  <h2 style={{ fontSize: 19, fontWeight: 650 }}>{service.name}</h2>

                  {service.description ? (
                    <p style={{ color: 'var(--ink-muted)', fontSize: 14.5 }}>
                      {service.description}
                    </p>
                  ) : null}

                  <p className="row fine">
                    <Icon name="clock" size={14} />
                    {t('catalogue.duration', { minutes: service.duration_minutes })}
                  </p>

                  <div className="stack" style={{ gap: 'var(--space-2)' }}>
                    <span className="field__label">{t('catalogue.modesLabel')}</span>
                    <div className="row-wrap" style={{ gap: 'var(--space-2)' }}>
                      {bookableModes(service.modes).map((mode) => (
                        <Badge key={mode}>{modes[mode].label}</Badge>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="stack" style={{ gap: 'var(--space-4)', alignItems: 'flex-end' }}>
                  <span className="stat__value" style={{ fontSize: 22 }}>
                    <Money value={service.price} />
                  </span>

                  {/* `brand`, because this is the clinic's surface and the clinic's
                      colour. Its foreground is `--brand-primary-fg`, which the API
                      computed for WCAG AA — never #fff assumed here. */}
                  <Button
                    variant="brand"
                    href={href(paths.book, { service: service.id })}
                  >
                    {t('catalogue.choose')}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </ul>
      )}
    </div>
  )
}
