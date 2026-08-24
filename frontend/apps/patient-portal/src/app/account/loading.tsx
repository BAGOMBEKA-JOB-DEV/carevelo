import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Card, Grid, Skeleton, Stack } from '@carevelo/ui'
import { PageBody } from '@/components/PageBody'

/**
 * The care hub, held in place while the session and the clinic are resolved.
 *
 * See services/loading.tsx for why there is no SiteShell and why `.site-root` still wraps
 * this.
 *
 * THE EYEBROW IS REAL AND THE HEADING IS NOT, and the split is the same one the other
 * fallbacks make: "Your care" is a fixed string, and the sentence under it is
 * "Welcome back, {firstName}" — a person's own name, which arrives with the session. A
 * placeholder name would be the single worst thing this fallback could render, so the line
 * is reserved and left empty.
 *
 * THE HUB IS FOUR CARDS AND THEN A BLOCK, and it is worth reserving precisely because it
 * is the page a patient lands on after signing in — the first thing they see on this
 * product, frequently on the slowest request of the session, since the sign-in redirect
 * and the tenant and session reads all land at once.
 */
export default async function AccountLoading(): Promise<ReactElement> {
  const t = await getTranslations('Account')

  return (
    <div className="site-root">
      <main>
        <PageBody>
          <Stack gap="7">
            <Stack gap="4">
              <span className="site-eyebrow">{t('eyebrow')}</span>
              <Skeleton lines={1} className="title-lg" />
            </Stack>

            {/*
             * `Grid cols={2}` collapses to one column at 700px, which is where the real hub
             * collapses too — so the fallback and the page agree about how many cards are
             * beside each other at every width, and a phone does not see a two-column
             * placeholder resolve into a single-column page.
             */}
            <Grid cols={2} gap="5">
              {Array.from({ length: 4 }, (_unused, index) => (
                <Card key={index}>
                  <Stack gap="4">
                    <Skeleton lines={1} />
                    <Skeleton lines={2} />
                    <Skeleton block="sm" />
                  </Stack>
                </Card>
              ))}
            </Grid>

            {/* The "opened from a link the clinic sends you" note under the cards. */}
            <Skeleton lines={3} />
          </Stack>
        </PageBody>
      </main>
    </div>
  )
}
