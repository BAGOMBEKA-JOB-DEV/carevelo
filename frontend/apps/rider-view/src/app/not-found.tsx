import { Button, PageHeader } from '@carevelo/ui'
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
 *
 * IT IS A `PageHeader` NOW AND IT WAS AN `EmptyState`, WHICH IS NOT A TIDY-UP.
 *
 * `EmptyState` renders its title as `<p class="empty__title">` — correct for what that
 * component is for, which is a REGION of a page that has nothing in it, sitting below the
 * page's own heading. Used as the whole of a route it left this page with no heading at
 * all: a screen-reader user pressing `1` to jump to the top level of an unfamiliar page
 * found nothing, and a page with no `<h1>` reads as a fragment of some other document. That
 * is the worst place in the app for it to happen, because a 404 is by definition where
 * somebody has arrived without meaning to and needs to be told where they are.
 *
 * `PageHeader` takes `title: string` and renders exactly one `<h1>` by construction. The
 * way out then gets to be what it should be on a phone: full width, 52px tall, at the
 * bottom of the column where a thumb already is, rather than a small centred link under a
 * paragraph.
 */
export default function NotFound() {
  return (
    <FieldShell active={null}>
      <PageHeader
        title="That is not here"
        description={
          'The page or the delivery you asked for is not on your round. If you followed a '
          + 'link from your clinic, ask them to send it again.'
        }
      />

      <Button href={DELIVERY_PATHS.assignments} variant="primary" size="lg" block>
        My deliveries
      </Button>
    </FieldShell>
  )
}
