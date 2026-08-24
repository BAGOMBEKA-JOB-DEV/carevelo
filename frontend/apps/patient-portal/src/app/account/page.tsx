import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { clinicMetadata } from '@/lib/metadata'
import { Icon, type IconName } from '@carevelo/ui'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { signOut } from '@/domains/identity'
import { SiteShell } from '@/components/SiteShell'
import { PageBody } from '@/components/PageBody'
import { SitePageHeader } from '@/components/SitePageHeader'

/**
 * Where a signed-in person lands, and the index of everything they can do here.
 *
 * A GUEST IS REDIRECTED, not shown an empty page: this route exists only for somebody with
 * a session, and the check asks the API rather than reading the cookie, because a cookie
 * cannot know it has been invalidated by a deactivation or a role change.
 *
 * A PATIENT WHOSE PASSWORD IS STILL THE CLINIC'S IS SENT TO CHOOSE ONE. Their temporary
 * password was generated at the front desk and read out to them, so it is known to a member
 * of staff — and the API refuses every other authenticated request until it is changed.
 * Landing them here would show a page whose every link fails at the first hop.
 *
 * ---------------------------------------------------------------------------------------
 * THIS PAGE USED TO SAY THE FEATURES WERE BEING BUILT. THEY ARE BUILT, SO IT LINKS TO THEM.
 *
 * AND TWO CARDS THAT WERE DELIBERATELY WITHHELD ARE NOW HERE. The reasoning that withheld
 * them is kept below rather than deleted, because it was right when it was written and
 * because the thing that changed is a fact about the API rather than a change of mind about
 * the design. What it said:
 *
 *   > Two whole journeys — paying for a dispensed order, choosing collection or delivery,
 *   > and tracking a delivery — have no entry point in this portal at all, because the API
 *   > has no patient-callable listing behind one: `DispenseOrderController::index()` and
 *   > `DeliveryController::index()` both authorise `viewAny`, which is clinic staff only,
 *   > and neither uses `AuthorisesPatientReads` (although `viewOwn` exists on both
 *   > policies, unused). [...] A "Your deliveries" card that opened onto a permanent empty
 *   > state would be worse than none: it would tell a patient that their delivery is not
 *   > there, when what is true is that this portal cannot ask.
 *
 * THAT IS NO LONGER TRUE. Both controllers now branch on `AuthorisesPatientReads`, which
 * authorises and narrows in a single call — a patient's listing returns only rows reaching
 * their own patient records — and the delivery branch renders `PatientDeliveryResource`,
 * the TRACKING projection: milestones, not the street address and not `failure_reason`,
 * which are the dispatcher's to see. So the cards below open onto real lists, and the test
 * the old note set has been met rather than waived: an empty list on either of them now
 * means the patient genuinely has none, which is a fact and not a limitation of the portal.
 *
 * WHAT SURVIVES FROM THAT REASONING, AND SHOULD KEEP SURVIVING: a card here is a promise
 * that the page behind it can answer. The rule was never "no cards for unbuilt things" —
 * it was that a plausible card for something that cannot work costs a patient more than a
 * missing one, because they stop looking. Anything added to this list later should have to
 * pass the same test.
 *
 * The `<Notice>` that used to sit under these cards — "Opened from a link {clinic} sends
 * you" — went with the gap it described. Keeping it would tell a patient to hold on to a
 * message they no longer need, and point them away from the two cards immediately above it.
 * ---------------------------------------------------------------------------------------
 *
 * THE HEADINGS AND CARD COPY LIVE IN THE `Routes` NAMESPACE, which is the route layer's own
 * and is deliberately thin. Everything the cards LINK to describes itself in its own
 * domain's catalogue; this page writes only the sentence that gets somebody there.
 */
export default async function AccountPage() {
  const [tenant, user] = await Promise.all([resolveTenant(), currentUser()])

  if (!user) {
    redirect('/sign-in')
  }

  // The API refuses every other authenticated request while this is set, so landing them
  // here would render a page whose every action fails. Typed now, not sniffed: /v1/me
  // returns MeResource and the field is in the generated client.
  if (user.password_change_required) {
    redirect('/set-password')
  }

  const [t, routes, common] = await Promise.all([
    getTranslations('Account'),
    getTranslations('Routes'),
    getTranslations('Common'),
  ])
  const clinic = tenant.trading_name ?? common('thisClinic')
  const phone = tenant.contact?.phone

  /*
   * The six places a patient can actually get to from here, in the order the journey
   * happens: see what is offered, book it, keep track of it, read what was prescribed,
   * settle up with the pharmacy and say how you want your medicines, then watch them come.
   *
   * THE ORDER IS THE JOURNEY AND NOT AN ALPHABET. A patient arriving at this hub is
   * somewhere along that line, and the card they want is the one after the thing that just
   * happened to them — a prescription is followed by an order, an order by a delivery. The
   * two new cards go at the END for that reason, not because they are new.
   *
   * THE CATALOGUE KEYS ARE WRITTEN OUT, NOT BUILT FROM A TEMPLATE LITERAL. `routes(\`hub.${key}.title\`)`
   * would compile — next-intl's generated key union does not survive interpolation — and
   * would then resolve a missing key at runtime to the literal string `Routes.hub.x.title`,
   * printed on the page where a sentence should be. Spelling them out is what makes a
   * renamed key a build failure, which is the whole reason this app types its catalogue.
   */
  const destinations: readonly { href: string; icon: IconName; title: string; body: string; action: string }[] = [
    {
      href: '/services',
      icon: 'file',
      title: routes('hub.services.title', { clinic }),
      body: routes('hub.services.body', { clinic }),
      action: routes('hub.services.action'),
    },
    {
      href: '/book',
      icon: 'calendar',
      title: routes('hub.book.title'),
      body: routes('hub.book.body'),
      action: routes('hub.book.action'),
    },
    {
      href: '/appointments',
      icon: 'clock',
      title: routes('hub.appointments.title'),
      body: routes('hub.appointments.body'),
      action: routes('hub.appointments.action'),
    },
    {
      href: '/prescriptions',
      icon: 'heart',
      title: routes('hub.prescriptions.title'),
      body: routes('hub.prescriptions.body'),
      action: routes('hub.prescriptions.action'),
    },
    {
      /*
       * `box` rather than `coins`, although this is the card behind which money is owed.
       * The order is the thing; paying for it is one of its states, and a purse icon on a
       * hub card would say "this is where you spend" to a patient who may simply be
       * checking whether their medicines are ready. The amount is on the list itself,
       * against the row it belongs to, where it can be true or false about one order
       * rather than about a whole card.
       */
      href: '/orders',
      icon: 'box',
      title: routes('hub.orders.title'),
      body: routes('hub.orders.body', { clinic }),
      action: routes('hub.orders.action'),
    },
    {
      href: '/deliveries',
      icon: 'truck',
      title: routes('hub.deliveries.title'),
      body: routes('hub.deliveries.body', { clinic }),
      action: routes('hub.deliveries.action'),
    },
  ]

  return (
    <SiteShell tenant={tenant} signedIn>
      {/* `.site-hub` is what carries this page's vertical rhythm — see the docblock on
          the heading below, and the rules in tokens/site.css beside `.cellgrid`'s 52px. */}
      <PageBody className="site-hub">
        <SitePageHeader
          eyebrow={t('eyebrow')}
          title={t('welcome', { firstName: firstName(user.name) })}
          description={t('signedInTo', { clinic })}
          actions={
            /*
             * A FORM, NOT A LINK, and the distinction is not pedantry. Signing out changes
             * state on the server; a link is a GET, and the router prefetches links it can
             * see. A patient whose session ended because the browser looked at the page is
             * the bug this shape makes impossible.
             */
            <form action={endSession}>
              <button className="btn btn-quiet" type="submit">
                <Icon name="lock" /> {t('signOut')}
              </button>
            </form>
          }
        />

        {/*
         * `.stat__value` is 28px, sized for a COUNT — "1,240", "6", a shilling total. Both
         * values here are a NAME, and a clinic's trading name at 28px in the display face
         * wraps to three lines inside a `.cell` on a 360px phone. `--md` is 21px, which is
         * a size this product already sets in the display face, and it keeps the face, the
         * weight and the tabular figures that make a stat value a stat value.
         *
         * This used to be `style={{ fontSize: 21 }}` with a paragraph explaining that the
         * modifier was the right answer and did not exist yet. It exists now — see
         * `.stat__value--sm` / `--md` in tokens/components.css, where the console's own
         * fourteen matching overrides can reach it too.
         */}
        <div className="cellgrid cellgrid--2">
          <div className="cell">
            <div className="stat">
              <span className="stat__label">{t('yourClinicLabel')}</span>
              <span className="stat__value stat__value--md">
                {clinic}
              </span>
              <span className="stat__note tnum">{phone ?? ''}</span>
            </div>
          </div>

          <div className="cell">
            <div className="stat">
              <span className="stat__label">{t('signedInAsLabel')}</span>
              <span className="stat__value stat__value--md">
                {user.name}
              </span>
              <span className="stat__note tnum">{user.phone ?? ''}</span>
            </div>
          </div>
        </div>

        {/*
         * NO INLINE STYLE, AND NO `<Stack>` EITHER, WHICH IS THE POINT.
         *
         * This page's vertical rhythm is a BLOCK formatting context and has to stay one:
         * `.cellgrid` carries a 52px `margin-top` of its own from the token layer and
         * `.page-head` a 24px `margin-bottom`, and in a block container those COLLAPSE to
         * 52px. Wrapping these children in a `<Stack>` stops the collapse, applies both,
         * and lands the Stack's gap on top — the page loosens by up to 76px with nothing
         * failing and nothing to see in a diff.
         *
         * So the three distances that were `style={{ marginTop: … }}` here are margins
         * still, but named ones: `.site-hub` on the PageBody above, and three rules in
         * tokens/site.css beside the 52px they complete. All four gaps down this page —
         * 30px, 52px, 24px, 18px — are now readable in one place instead of three
         * elements and a stylesheet.
         *
         * `.site-h2` sets its own 14px `margin-top` for the marketing sections it was
         * written for; 30px is the working page's step, and it is on the scale.
         */}
        <h2 className="site-h2">{routes('hub.doHeading')}</h2>

        <div className="cellgrid cellgrid--2">
          {destinations.map((destination) => (
            /*
             * The whole card is the link. A patient tapping on a cracked screen on a bus
             * should not have to find a four-word phrase inside it, and `a.cell` is styled
             * for exactly this — the "more" line below is the affordance, not the target.
             */
            <Link className="cell" href={destination.href} key={destination.href}>
              <span className="cell__ic" aria-hidden="true">
                <Icon name={destination.icon} />
              </span>
              <h3>{destination.title}</h3>
              <p>{destination.body}</p>
              <span className="more lnk">
                {destination.action} <Icon name="arrowRight" size={15} />
              </span>
            </Link>
          ))}
        </div>

        {/* Two whole sentences rather than one with a fragment glued on where the phone
            number goes. A translator handed "on {phone}" in isolation has no way to know
            what it attaches to, and in a language whose word order differs from English it
            may not attach there at all. */}
        <p className="fine">
          {phone ? t('contactWithPhone', { clinic, phone }) : t('contact', { clinic })}
        </p>
      </PageBody>
    </SiteShell>
  )
}

async function endSession() {
  'use server'

  const { redirect: go } = await import('next/navigation')

  await signOut()

  go('/')
}

/** The name people answer to. A full legal name in a greeting reads like a summons. */
function firstName(name: string): string {
  return name.split(' ')[0] ?? name
}

/** The clinic's name in the tab. Exported per page — see lib/metadata.ts. */
export const generateMetadata = clinicMetadata
