import { getTranslations } from 'next-intl/server'
import { Badge, Button, Card, EmptyState, Icon, Inline, Money, Notice, Stack } from '@carevelo/ui'
import type { Tenant } from '@/lib/tenant'
import { listServices } from '../api/catalogue'
import { attempt } from '../api/http'
import { href } from '../model/links'
import { bookableModes } from '../model/slots'
import type { SchedulingPaths } from '../model/types'
import { modeText } from './strings'
import { PageBody } from '@/components/PageBody'
import { SitePageHeader } from '@/components/SitePageHeader'

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
    <PageBody>
      <SitePageHeader
        eyebrow={t('catalogue.eyebrow')}
        title={t('catalogue.title')}
        description={t('catalogue.lede', { clinic })}
      />

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
           discovering. `Card as="li"` is why that element prop exists.

           `<Stack as="ul">` and not `<ul className="stack">`, and it is worth naming what
           that changes: the hand-rolled version never reset the list, so this catalogue
           was rendering with the user agent's disc bullets and a 40px indent down the left
           of every service card. Stack strips both by construction and puts `role="list"`
           back on — Safari drops list semantics from an element whose `list-style` is
           `none`, so removing the marker without restoring the role would cost the "list,
           6 items" a screen reader announces before it starts reading. */
        <Stack as="ul" gap="5">
          {loaded.value.map((service) => (
            <Card as="li" key={service.id}>
              <Inline gap="6" justify="between" align="start">
                <Stack gap="3" className="grow">
                  {/* SURVIVING INLINE STYLE. 19px at weight 650 is a card heading and there
                      is no step on the type scale at that size: `.title` is 21px/600 and
                      `.title-sm` is 17.5px/700 in the display face. One of the two or three
                      heading modifiers that belong in tokens/components.css, which is not
                      this sweep's file — see the note in src/app/account/page.tsx. */}
                  <h2 className="card-title">{service.name}</h2>

                  {service.description ? (
                    /* `.muted` and no size: the 14.5px that used to be written here IS
                       `--text-base-size`, which a `<p>` inherits from `body` anyway. The
                       property was restating the default. */
                    <p className="muted">{service.description}</p>
                  ) : null}

                  <p className="row fine">
                    <Icon name="clock" size={14} />
                    {t('catalogue.duration', { minutes: service.duration_minutes })}
                  </p>

                  <Stack gap="2">
                    <span className="field__label">{t('catalogue.modesLabel')}</span>
                    <Inline gap="2">
                      {bookableModes(service.modes).map((mode) => (
                        <Badge key={mode}>{modes[mode].label}</Badge>
                      ))}
                    </Inline>
                  </Stack>
                </Stack>

                <Stack gap="4" align="end">
                  {/* A price, not a count: `.stat__value`'s own 28px puts "UGX 30,000"
                      onto two lines beside the button on a phone, and `.stat__value--md`
                      is the 21px step that fits. */}
                  <span className="stat__value stat__value--md">
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
                </Stack>
              </Inline>
            </Card>
          ))}
        </Stack>
      )}
    </PageBody>
  )
}
