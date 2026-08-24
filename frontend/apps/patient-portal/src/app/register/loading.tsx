import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Card, Grid, Skeleton, Stack } from '@carevelo/ui'
import { PageBody } from '@/components/PageBody'

/**
 * The registration form, held in place while the clinic is resolved.
 *
 * See services/loading.tsx for why there is no `SiteShell` and why `.site-root` still wraps
 * this.
 *
 * WHAT THIS ROUTE IS ACTUALLY WAITING ON. `resolveTenant()` and `currentUser()` run in
 * parallel, and the second one exists to bounce somebody who is already signed in straight
 * to their care rather than let them register twice. So the wait is two round trips deep on
 * a route that is frequently the very first thing a patient does on this product, from a
 * link somebody read out to them over a telephone.
 *
 * THE EYEBROW IS REAL. "Register" takes no arguments in either catalogue. The heading is
 * "Register with {clinic}" and the sentence under it names the clinic twice, so both are
 * reserved: this is the screen where a patient decides whether they are handing their name
 * and telephone number to the practice they meant to, and a placeholder that named the
 * wrong one for a quarter of a second would be wrong about precisely that.
 *
 * `maxWidth: 640` REPRODUCED FROM `RegistrationForm`'s OWN WRAPPER, because the form is
 * markedly narrower than the site measure and a fallback at full width would collapse
 * inward the moment the real screen landed. It is written as an inline style here for the
 * same reason it is one there: it is a measure belonging to one screen, and the layout
 * primitives deliberately model the space between things rather than the width around them.
 *
 * TWO CARDS ACROSS AND THEN ONE. `Grid cols={2}` is what the real form uses for "the
 * patient" and "the rest of it", and it collapses at the same width, so the fallback and the
 * page agree about the column count at every viewport. The guardian card below them appears
 * only for somebody under 18 — which is not knowable here — so it is reserved as a single
 * short block rather than drawn as a third panel.
 */
export default async function RegisterLoading(): Promise<ReactElement> {
  const t = await getTranslations('Patients')

  return (
    <div className="site-root">
      <main>
        <PageBody>
          <div className="grid" style={{ gap: 'var(--space-7)', maxWidth: 640 }}>
            <div className="site-sec-head">
              <Stack gap="4">
                <span className="site-eyebrow">{t('register.eyebrow')}</span>
                <Skeleton lines={1} className="title-lg" />
                <Skeleton lines={2} />
              </Stack>
            </div>

            <Card as="section">
              <Stack gap="6">
                {/* "What we need from you" and the sentence under it. */}
                <Skeleton lines={1} className="title-sm" />

                <Grid cols={2} gap="5">
                  <Skeleton block="md" />
                  <Skeleton block="md" />
                </Grid>

                {/* The consent line and the submit button under the fields. */}
                <Skeleton block="sm" />
              </Stack>
            </Card>
          </div>
        </PageBody>
      </main>
    </div>
  )
}
