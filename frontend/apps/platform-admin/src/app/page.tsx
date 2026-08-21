import { ControlPlaneShell } from '@/components/ControlPlaneShell'
import { SECTION_IDS, SECTIONS } from '@/components/sections'

/**
 * Thin by design: a route composes domains and holds no logic, which the boundary
 * rules enforce. Features arrive in src/domains/.
 *
 * Until they do, this is the map. It used to say "Shell, tokens and structure. Features
 * land in the domains next." above three links that all 404'd. Naming the three screens
 * and what each is for is more useful to whoever opens this next, and it stays useful as
 * they are built one at a time.
 *
 * `active={null}`: the landing page is not one of the nav sections, and it says so rather
 * than leaving the prop off.
 */
export default function HomePage() {
  return (
    <ControlPlaneShell title="Platform admin" active={null}>
      <div className="page-head">
        <div className="grow">
          <h1>Platform admin</h1>
          <p>
            Three screens, none of them built yet. Each one below has a route and a place in
            the nav, and says what will live there.
          </p>
        </div>
      </div>

      <div className="grid g-3">
        {SECTION_IDS.map((id) => (
          <div className="card stack" key={id}>
            <h3>
              <a href={SECTIONS[id].href}>{SECTIONS[id].label}</a>
            </h3>
            <p className="muted">{SECTIONS[id].lede}</p>
          </div>
        ))}
      </div>
    </ControlPlaneShell>
  )
}
