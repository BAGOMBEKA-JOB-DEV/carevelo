import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { clinicMetadata } from '@/lib/metadata'
import { Icon } from '@carevelo/ui'
import { resolveTenant } from '@/lib/tenant'
import { currentUser } from '@/lib/session'
import { signOut } from '@/domains/identity'
import { SiteShell } from '@/components/SiteShell'

/**
 * Where a signed-in person lands.
 *
 * A GUEST IS REDIRECTED, not shown an empty page: this route exists only for somebody
 * with a session, and the check asks the API rather than reading the cookie, because a
 * cookie cannot know it has been invalidated by a deactivation or a role change.
 *
 * A PATIENT WHOSE PASSWORD IS STILL THE CLINIC'S IS SENT TO CHOOSE ONE. Their temporary
 * password was generated at the front desk and read out to them, so it is known to a
 * member of staff — and the API refuses every other authenticated request until it is
 * changed. Landing them here would show a page whose every future feature would fail.
 *
 * Booking, prescriptions and delivery tracking arrive in the next phase and this page says
 * so in as many words. What it does not do is show a plausible empty state for a feature
 * that does not exist — a patient waiting on a delivery card that will never populate is
 * worse served than one told plainly.
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

  const [t, common] = await Promise.all([
    getTranslations('Account'),
    getTranslations('Common'),
  ])
  const clinic = tenant.trading_name ?? common('thisClinic')
  const phone = tenant.contact?.phone

  return (
    <SiteShell tenant={tenant} signedIn>
      <div className="site-wrap" style={{ paddingBlock: 'var(--space-8)' }}>
        <div className="page-head">
          <div style={{ flex: '1 1 auto' }}>
            <span className="site-eyebrow">{t('eyebrow')}</span>
            <h1 style={{ marginTop: 'var(--space-4)' }}>
              {t('welcome', { firstName: firstName(user.name) })}
            </h1>
            <p>{t('signedInTo', { clinic })}</p>
          </div>

          {/*
           * A FORM, NOT A LINK, and the distinction is not pedantry. Signing out changes
           * state on the server; a link is a GET, and the router prefetches links it can
           * see. A patient whose session ended because the browser looked at the page is
           * the bug this shape makes impossible.
           */}
          <form action={endSession}>
            <button className="btn btn-quiet" type="submit">
              <Icon name="lock" /> {t('signOut')}
            </button>
          </form>
        </div>

        <div className="cellgrid cellgrid--3">
          <div className="cell">
            <div className="stat">
              <span className="stat__label">{t('yourClinicLabel')}</span>
              <span className="stat__value" style={{ fontSize: 21 }}>
                {clinic}
              </span>
              <span className="stat__note tnum">{phone ?? ''}</span>
            </div>
          </div>

          <div className="cell">
            <div className="stat">
              <span className="stat__label">{t('signedInAsLabel')}</span>
              <span className="stat__value" style={{ fontSize: 21 }}>
                {user.name}
              </span>
              <span className="stat__note tnum">{user.phone ?? ''}</span>
            </div>
          </div>

          <div className="cell">
            <div className="stat">
              <span className="stat__label">{t('nextStepLabel')}</span>
              <span className="stat__value" style={{ fontSize: 21 }}>
                {t('nextStepValue')}
              </span>
              <span className="stat__note">{t('nextStepNote')}</span>
            </div>
          </div>
        </div>

        <div className="notice notice-info" style={{ marginTop: 'var(--space-7)' }}>
          {t('notice', { clinic })}
        </div>

        {/* Two whole sentences rather than one with a fragment glued on where the phone
            number goes. A translator handed "on {phone}" in isolation has no way to know
            what it attaches to, and in a language whose word order differs from English it
            may not attach there at all. */}
        <p className="fine" style={{ marginTop: 'var(--space-6)' }}>
          {phone ? t('contactWithPhone', { clinic, phone }) : t('contact', { clinic })}
        </p>
      </div>
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
