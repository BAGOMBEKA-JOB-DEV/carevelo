import { ConsoleShell } from '@/components/ConsoleShell'
import { PageHeader } from '@carevelo/ui'
import { SECTION_IDS, SECTIONS } from '@/components/sections'

/**
 * Thin by design: a route composes domains and holds no logic, which the boundary
 * rules enforce. Features arrive in src/domains/.
 *
 * Until they do, this is the map. It used to say "Shell, tokens and structure. Features
 * land in the domains next." above a sidebar of six links that all 404'd, which told a
 * clinic nothing and told us less. Naming the six screens and what each is for is a more
 * useful thing for somebody opening this console to find, and it stays useful as they are
 * built one at a time.
 *
 * `active={null}`: the landing page is not one of the nav sections, and it says so rather
 * than leaving the prop off.
 */
export default function HomePage() {
  return (
    <ConsoleShell title="Clinic console" active={null}>
      <PageHeader
        title="Clinic console"
        description={
          <>
            Six screens, none of them built yet. Each one below has a route and a place in
            the nav, and says what will live there.
          </>
        }
      />

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
    </ConsoleShell>
  )
}
