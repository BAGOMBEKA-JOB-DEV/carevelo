'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { Tenant } from '@/lib/tenant'

/**
 * The clinic's header. Fixed, and it condenses once the page scrolls.
 *
 * The ONLY client component in this app, and the scroll class is the only reason it is
 * one. Everything it does without JavaScript still works: the header renders at full
 * height, the links navigate, the sign-in button is a link. The frosting is decoration
 * that arrives if the bundle does.
 *
 * `passive: true` on the listener because a scroll handler that can block scrolling is
 * worse than no handler at all on a mid-range Android phone.
 */
export function SiteHeader({ tenant, signedIn }: { tenant: Tenant; signedIn: boolean }) {
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)

    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const name = tenant.trading_name ?? 'Clinic'
  const logo = tenant.branding?.logo_url

  return (
    <header className={`site-header${scrolled ? ' is-scrolled' : ''}`}>
      <div className="site-wrap site-header__row">
        <Link className="site-brand" href="/">
          {logo ? (
            /*
             * A plain <img> deliberately: next/image would route a tenant-uploaded asset
             * through Next's optimiser, adding client JS to a surface already over its
             * budget, for an image the backend already validated, stripped and re-encoded.
             */
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={name} style={{ maxHeight: 34, width: 'auto' }} />
          ) : (
            // No logo yet: the clinic's initial on its own colour, with the foreground the
            // API computed for contrast.
            <span className="site-brand__mark" aria-hidden="true">
              {name.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="site-brand__text">
            <span>{name}</span>
            <span className="site-brand__sub">Book · Consult · Collect</span>
          </span>
        </Link>

        <nav className="site-navlinks" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#care">Your care</a>
          <a href="#trust">Safety</a>
        </nav>

        <div className="site-header__right">
          {signedIn ? (
            <Link className="btn btn-brand" href="/account">
              My care
            </Link>
          ) : (
            <Link className="btn btn-brand" href="/sign-in">
              Sign in
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
