import type { ReactNode } from 'react'

/**
 * ConsoleShell — the clinic console frame.
 *
 * Carevelo branding, with the clinic's logo in the header: staff know they use
 * Carevelo, and the clinic is the customer rather than the audience.
 *
 * aria-current on the active item, not only a colour and a bar. Colour alone fails a
 * colour-blind user and says nothing to a screen reader.
 */
export function ConsoleShell({ title, active, logoUrl, children }: { title: string; active?: string; logoUrl?: string | null; children: ReactNode }) {
  return (
    <div className="layout">
      <a className="skip-link" href="#main">Skip to content</a>

      <aside className="sidebar">
        <div className="sidebar__brand">
          <strong>Carevelo</strong>
        </div>
        <nav className="sidebar__nav" aria-label="Sections">
          <div className="nav-group">
            <a href="/schedule" className={`nav-item${active === 'schedule' ? ' is-active' : ''}`} aria-current={active === 'schedule' ? 'page' : undefined}>Schedule</a>
            <a href="/patients" className={`nav-item${active === 'patients' ? ' is-active' : ''}`} aria-current={active === 'patients' ? 'page' : undefined}>Patients</a>
            <a href="/pharmacy" className={`nav-item${active === 'pharmacy' ? ' is-active' : ''}`} aria-current={active === 'pharmacy' ? 'page' : undefined}>Pharmacy</a>
            <a href="/dispatch" className={`nav-item${active === 'dispatch' ? ' is-active' : ''}`} aria-current={active === 'dispatch' ? 'page' : undefined}>Dispatch</a>
            <a href="/payments" className={`nav-item${active === 'payments' ? ' is-active' : ''}`} aria-current={active === 'payments' ? 'page' : undefined}>Payments</a>
            <a href="/settings" className={`nav-item${active === 'settings' ? ' is-active' : ''}`} aria-current={active === 'settings' ? 'page' : undefined}>Settings</a>
          </div>
        </nav>
      </aside>

      <div>
        <header className="topbar">
          <span className="topbar__title">{title}</span>
          <span className="topbar__spacer" />
          {logoUrl ? <img className="topbar__logo" src={logoUrl} alt="" /> : null}
        </header>
        <main className="content" id="main">{children}</main>
        <nav className="tabbar" aria-label="Sections">
          <a href="/schedule" className={active === 'schedule' ? 'is-active' : undefined} aria-current={active === 'schedule' ? 'page' : undefined}>Schedule</a>
          <a href="/patients" className={active === 'patients' ? 'is-active' : undefined} aria-current={active === 'patients' ? 'page' : undefined}>Patients</a>
          <a href="/pharmacy" className={active === 'pharmacy' ? 'is-active' : undefined} aria-current={active === 'pharmacy' ? 'page' : undefined}>Pharmacy</a>
          <a href="/dispatch" className={active === 'dispatch' ? 'is-active' : undefined} aria-current={active === 'dispatch' ? 'page' : undefined}>Dispatch</a>
          <a href="/payments" className={active === 'payments' ? 'is-active' : undefined} aria-current={active === 'payments' ? 'page' : undefined}>Payments</a>
          <a href="/settings" className={active === 'settings' ? 'is-active' : undefined} aria-current={active === 'settings' ? 'page' : undefined}>Settings</a>
        </nav>
      </div>
    </div>
  )
}
