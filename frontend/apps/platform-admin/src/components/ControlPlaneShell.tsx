import type { ReactNode } from 'react'

/**
 * ControlPlaneShell — the platform admin frame.
 *
 * Carevelo's own surface. Reaches no clinical data without an audited break-glass
 * grant, so the chrome deliberately looks like an internal tool rather than a
 * clinical one.
 *
 * aria-current on the active item, not only a colour and a bar. Colour alone fails a
 * colour-blind user and says nothing to a screen reader.
 */
export function ControlPlaneShell({ title, active, logoUrl, children }: { title: string; active?: string; logoUrl?: string | null; children: ReactNode }) {
  return (
    <div className="layout">
      <a className="skip-link" href="#main">Skip to content</a>

      <aside className="sidebar">
        <div className="sidebar__brand">
          <strong>Carevelo</strong>
        </div>
        <nav className="sidebar__nav" aria-label="Sections">
          <div className="nav-group">
            <a href="/tenants" className={`nav-item${active === 'tenants' ? ' is-active' : ''}`} aria-current={active === 'tenants' ? 'page' : undefined}>Tenants</a>
            <a href="/break-glass" className={`nav-item${active === 'break-glass' ? ' is-active' : ''}`} aria-current={active === 'break-glass' ? 'page' : undefined}>Break-glass</a>
            <a href="/audit" className={`nav-item${active === 'audit' ? ' is-active' : ''}`} aria-current={active === 'audit' ? 'page' : undefined}>Audit</a>
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
          <a href="/tenants" className={active === 'tenants' ? 'is-active' : undefined} aria-current={active === 'tenants' ? 'page' : undefined}>Tenants</a>
          <a href="/break-glass" className={active === 'break-glass' ? 'is-active' : undefined} aria-current={active === 'break-glass' ? 'page' : undefined}>Break-glass</a>
          <a href="/audit" className={active === 'audit' ? 'is-active' : undefined} aria-current={active === 'audit' ? 'page' : undefined}>Audit</a>
        </nav>
      </div>
    </div>
  )
}
