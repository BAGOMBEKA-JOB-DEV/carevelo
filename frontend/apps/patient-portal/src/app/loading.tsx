import type { ReactElement } from 'react'
import { Skeleton, Stack } from '@carevelo/ui'

/**
 * The clinic's front page, in the shape it will arrive in.
 *
 * IT IS THE ROOT FALLBACK AND IT IS ALSO THE FRONT PAGE'S OWN, which is only true because
 * `/` is the front page. Next uses the nearest `loading.tsx` above the segment being
 * rendered, so anything not given one of its own would land here — and today nothing does:
 * every other route in this app either has its own file or sits under a segment that does.
 * That is worth knowing before adding a route. A new screen with no `loading.tsx` beside it
 * inherits the shape of the clinic's hero band, which is the right fallback for exactly one
 * page in this product.
 *
 * See services/loading.tsx for why there is no `SiteShell` here and why the frame arrives
 * with the page instead.
 *
 * `.site-root` IS HERE FOR THE USUAL REASON AND `.site-hero` FOR THE OPPOSITE ONE. On every
 * other route the wrapper hands back `padding-top: var(--hh)` — the room the fixed header is
 * about to take — so the swap is a fill rather than a jolt. This route is the exception:
 * `.site-hero` carries `margin-top: calc(-1 * var(--hh))` because the band deliberately runs
 * up UNDER the header. Rendering both reproduces that cancellation exactly, and rendering
 * only one of them would put the whole page an entire header's height out.
 *
 * THE BAND IS RENDERED FOR REAL RATHER THAN GREYED, and it is the one place in this app
 * where that decision needs defending. `.site-hero__bg` is dark in both themes over an
 * opaque floor, with two brand-tinted washes above it — and the wash reads the clinic's
 * tokens, which this component cannot resolve, so it paints with the package defaults for
 * the moment it is up. That is a subtle shift of tint on a band that is dark either way.
 * The alternative is a white rectangle where a dark band is about to be, on the first screen
 * of the product a patient ever sees, which is not a subtle difference at all.
 *
 * NOT ONE WORD OF THE HERO IS RENDERED. The eyebrow is the clinic's district when it has one
 * and "Uganda" when it does not; the headline and the sentence under it both name the
 * clinic. All three arrive with the tenant, and a front page that said the wrong district
 * for a moment would be wrong about the one fact a patient uses to decide they are in the
 * right place.
 *
 * ONLY THE FIRST SCREENFUL IS RESERVED. Below the fold this page runs five marketing
 * sections; reserving them would be several hundred pixels of grey a patient scrolls
 * through, to save reflow on content nobody is looking at yet.
 */
export default function HomeLoading(): ReactElement {
  return (
    <div className="site-root">
      <main>
        <section className="site-hero">
          <div className="site-hero__bg" aria-hidden="true" />

          <div className="site-wrap site-hero__inner">
            {/* `.site-hero__inner > *` caps each child at a 660px measure, so the bars take
                the width the sentences will take rather than the width of the viewport. */}
            <Stack gap="5">
              {/* The eyebrow — district and country. */}
              <Skeleton lines={1} />

              {/* The headline. `.title-lg` is the nearest step on the type scale to
                  `.site-h1`, so the bars stand at the height of the line rather than at
                  body height. Two lines because that is what this headline is on a phone. */}
              <Skeleton lines={2} className="title-lg" />

              {/* The sentence under it. */}
              <Skeleton lines={2} />

              {/* The call to action. It is one button for a signed-in patient and two for a
                  visitor — `currentUser()` decides, and this file cannot know — so the row
                  is reserved at its height and drawn as neither. */}
              <Skeleton block="sm" />

              {/* The two chips: mobile money, and any phone with a browser. */}
              <Skeleton lines={1} />
            </Stack>
          </div>
        </section>
      </main>
    </div>
  )
}
