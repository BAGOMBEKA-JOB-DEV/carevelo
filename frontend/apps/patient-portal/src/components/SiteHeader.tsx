'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Icon, ThemeToggle } from '@carevelo/ui'
import type { Tenant } from '@/lib/tenant'

/**
 * The clinic's header. Fixed, it overlays the hero, and it condenses once you scroll.
 *
 * THE ONLY CLIENT COMPONENT ON THIS SURFACE, and the scroll state is the whole reason
 * it is one. Everything it does without JavaScript still works: the header renders at
 * full height, every link navigates, the sign-in button is a link and the clinic's name
 * and logo are in the server-rendered HTML. Only the frosting and the drawer need the
 * bundle to arrive — and the at-rest inversion over the dark hero is done in CSS with
 * :has(), so even that is right before hydration rather than a frame after it.
 *
 * `passive: true` on the scroll listener because a handler that can block scrolling is
 * worse than no handler at all on a mid-range Android phone, which is the device this
 * product is built for.
 */

/*
 * Separate enter and leave thresholds. A single threshold sitting exactly at the
 * boundary flips back and forth on sub-pixel scroll or elastic overscroll, and a
 * header that flickers while a patient rests their thumb reads as a broken page.
 */
const ENTER = 24
const LEAVE = 8

/* The header's own links point at sections of the landing page. Privacy and Terms are
   deliberately not here — they belong in the footer, where a patient looks for them. */
const SECTIONS = [
  { href: '/#how', label: 'How it works', icon: 'clock', blurb: 'Book, consult, collect' },
  { href: '/#care', label: 'Your care', icon: 'heart', blurb: 'Consultations, prescriptions, delivery' },
  { href: '/#trust', label: 'Safety', icon: 'shield', blurb: 'Who can see your records' },
] as const

export function SiteHeader({ tenant, signedIn }: { tenant: Tenant; signedIn: boolean }) {
  const pathname = usePathname()
  const [scrolled, setScrolled] = useState(false)
  const [hasHero, setHasHero] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    let frame = 0
    let ticking = false

    const read = () => {
      ticking = false
      const y = window.scrollY
      // The previous state is read through the updater rather than from the closure,
      // so the hysteresis compares against what is actually on screen.
      setScrolled((was) => (was ? y > LEAVE : y > ENTER))
    }

    // rAF-coalesced, and the listener itself never reads layout, so scrolling stays on
    // the compositor no matter how fast the events arrive.
    const onScroll = () => {
      if (ticking) return
      ticking = true
      frame = requestAnimationFrame(read)
    }

    // Once on mount: a reload part-way down the page must not start in the wrong state.
    read()
    window.addEventListener('scroll', onScroll, { passive: true })

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('scroll', onScroll)
    }
  }, [])

  /*
   * "Is there a dark band behind the bar?" — asked of the DOM rather than of a list of
   * routes, so a page that gains or loses its hero needs no change here. /privacy and
   * /terms have no hero, open on the light canvas, and must never invert: white text on
   * a white page is not a subtle defect.
   */
  useEffect(() => {
    setHasHero(document.querySelector('.site-hero') !== null)
  }, [pathname])

  // Navigating from the drawer closes it. The drawer is a menu, not a page.
  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  useEffect(() => {
    if (!menuOpen) return

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false)
    }

    window.addEventListener('keydown', onKey)

    return () => window.removeEventListener('keydown', onKey)
  }, [menuOpen])

  // Grown to desktop with the drawer open, the drawer's own media query hides it while
  // the burger's aria-expanded still says "true". Close it so the two cannot disagree.
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 901px)')

    const close = (event: MediaQueryListEvent) => {
      if (event.matches) setMenuOpen(false)
    }

    desktop.addEventListener('change', close)

    return () => desktop.removeEventListener('change', close)
  }, [])

  const onDark = !scrolled && hasHero
  const name = tenant.trading_name
  const logo = tenant.branding.logo_url
  const accountHref = signedIn ? '/account' : '/sign-in'
  const accountLabel = signedIn ? 'My care' : 'Sign in'

  return (
    <header
      className={`site-header${scrolled ? ' is-scrolled' : ''}${onDark ? ' on-dark' : ''}`}
    >
      <div className="site-wrap site-header__row">
        <Link className="site-brand" href="/">
          {logo ? (
            /*
             * A plain <img> deliberately: next/image would route a tenant-uploaded asset
             * through Next's optimiser, adding client JS to a surface already over its
             * budget, for an image the backend already validated, stripped and re-encoded.
             *
             * A style OBJECT, which React sets through the CSSOM. No tenant value is ever
             * concatenated into markup or into a style string.
             */
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logo} alt={name} style={{ maxHeight: 34, width: 'auto' }} />
          ) : (
            // No logo yet: the clinic's initial on the clinic's colour, with the
            // foreground the API computed for contrast against it.
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
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              href={section.href}
              aria-current={isCurrentPage(section.href, pathname) ? 'page' : undefined}
            >
              {section.label}
            </Link>
          ))}
        </nav>

        <div className="site-header__right">
          <Link className="btn btn-brand" href={accountHref}>
            {accountLabel}
          </Link>
        </div>

        <ThemeToggle />

        {/* Three separately-transformed bars so they can morph into an X, rather than
            swapping one icon for another. aria-expanded is the part the reference
            omits: a burger with no expanded state tells a screen-reader user nothing
            about what pressing it did. */}
        <button
          type="button"
          className={`site-burger${menuOpen ? ' open' : ''}`}
          aria-expanded={menuOpen}
          aria-controls="site-menu"
          aria-label="Menu"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span className="site-burger__box" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </button>
      </div>

      <div id="site-menu" className={`site-mobile${menuOpen ? ' open' : ''}`}>
        <nav className="site-mobile__nav">
          {SECTIONS.map((section) => (
            <Link
              key={section.href}
              className="site-mobile__link"
              href={section.href}
              aria-current={isCurrentPage(section.href, pathname) ? 'page' : undefined}
            >
              <span className="site-mobile__ic" aria-hidden="true">
                <Icon name={section.icon} />
              </span>
              <span className="site-mobile__t">
                <b>{section.label}</b>
                <span>{section.blurb}</span>
              </span>
              <span className="site-mobile__chev" aria-hidden="true">
                <Icon name="chev" />
              </span>
            </Link>
          ))}
        </nav>

        <div className="site-mobile__sep" />

        <span className="site-mobile__label">Your account</span>
        <Link className="btn btn-brand btn-lg site-mobile__cta" href={accountHref}>
          {accountLabel}
        </Link>
      </div>
    </header>
  )
}

/**
 * Whether a link points at the page currently being viewed.
 *
 * A fragment names a section WITHIN a page, so `/#how` is never "the current page" —
 * marking all three section links aria-current on the landing page would tell a screen
 * reader that the patient is in three places at once, which is worse than saying
 * nothing. Route links get the marker; anchors get the underline on hover only.
 */
function isCurrentPage(href: string, pathname: string): boolean {
  return !href.includes('#') && href === pathname
}
