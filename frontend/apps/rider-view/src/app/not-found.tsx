import { Button, EmptyState } from '@carevelo/ui'
import { FieldShell } from '@/components/FieldShell'
import { DELIVERY_PATHS } from '@/app/paths'

/**
 * Not found — and, on this surface, deliberately incurious about why.
 *
 * THIS PAGE IS RENDERED FOR TWO DIFFERENT SITUATIONS AND MUST NOT DISTINGUISH THEM. A
 * delivery id that never existed, and a delivery id that belongs to another rider or
 * another clinic entirely, both arrive here: `getAssignment()` collapses 404 and 403 into
 * one null for exactly that reason. A page that said "that delivery is not yours" would
 * confirm the record exists somewhere, which is how somebody learns that a named person is
 * a patient of some other clinic. Cross-tenant reads are 404, never 403, all the way to
 * the words on the screen.
 *
 * WITHOUT THIS FILE Next serves its own built-in 404: an unstyled page with no navigation,
 * no way back to the round, and — because it is not our layout — none of the app's own
 * frame. A rider who mistypes a URL or opens a stale link should land somewhere that looks
 * like the app and has one obvious button on it.
 *
 * `active={null}` because a 404 is not one of the two tabs, and the prop says so rather
 * than being left off.
 */
export default function NotFound() {
  return (
    <FieldShell active={null}>
      <EmptyState
        title="That is not here"
        icon="help"
        action={
          <Button href={DELIVERY_PATHS.assignments} variant="primary" size="lg">
            My deliveries
          </Button>
        }
      >
        The page or the delivery you asked for is not on your round. If you followed a link
        from your clinic, ask them to send it again.
      </EmptyState>
    </FieldShell>
  )
}
