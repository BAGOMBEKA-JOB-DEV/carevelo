/**
 * Thin by design: a route composes domains and holds no logic, which the boundary
 * rules enforce. Features arrive in src/domains/.
 */
export default function HomePage() {
  return (
    <div className="page-head">
      <div className="grow">
        <h1>Platform admin</h1>
        <p>Shell, tokens and structure. Features land in the domains next.</p>
      </div>
    </div>
  )
}
