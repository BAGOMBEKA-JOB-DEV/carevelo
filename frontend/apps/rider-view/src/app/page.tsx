import { FieldShell } from '@/components/FieldShell'
import { SECTIONS } from '@/components/sections'

/**
 * Thin by design: a route composes domains and holds no logic, which the boundary
 * rules enforce. Features arrive in src/domains/.
 *
 * NOT A REDIRECT TO /assignments, though that is where a rider is going. A redirect would
 * be the right call once there is an assignment list to redirect to; today it would send a
 * rider from one placeholder to another and hide the fact that neither is real. When the
 * list exists, this page should become that redirect.
 *
 * `active={null}`: the landing page is not one of the tabs, and it says so rather than
 * leaving the prop off.
 */
export default function HomePage() {
  return (
    <FieldShell active={null}>
      <div className="empty">
        <p className="empty__title">Nothing to deliver yet</p>
        <p>
          This app is not built. When it is, the deliveries assigned to you will be on the{' '}
          <a href={SECTIONS.assignments.href}>Assignments</a> tab and the ones you have
          finished on <a href={SECTIONS.completed.href}>Completed</a>.
        </p>
      </div>
    </FieldShell>
  )
}
