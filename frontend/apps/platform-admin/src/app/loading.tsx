import type { ReactElement } from 'react'
import { Card, Grid, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ControlPlaneShell } from '@/components/ControlPlaneShell'

/**
 * The overview, in the shape it will arrive in — and the fallback every route in this app
 * inherits unless it has a closer one.
 *
 * ------------------------------------------------------------------------------------
 * A ROOT `loading.tsx` IS HONEST HERE AND IS NOT HONEST IN THE OTHER THREE APPS.
 *
 * A root fallback covers every route below it, so it is only ever right when every route
 * below it has the same shape. That is true of this app and of no other: all five screens
 * render `ControlPlaneShell` with a page head and a run of cards under it, and there is no
 * sign-in route — this surface has no full-bleed authentication split screen to be wrong
 * about. The patient portal, the console and the rider view all do have one, so a root
 * fallback there would put a card stack in front of a login form; each of those apps gets
 * per-section files instead.
 *
 * `active={null}` matches app/page.tsx: the overview is not one of the three nav sections
 * and says so out loud rather than by omission. The routes that ARE a section override this
 * file with their own, so no wrong tab is ever highlighted during a wait.
 * ------------------------------------------------------------------------------------
 *
 * The frame is rendered rather than skeletoned because `ControlPlaneShell` is a synchronous
 * server component that fetches nothing — the sidebar, the topbar and the tab bar cost this
 * fallback nothing at all, and without them the whole console would blink out and come back
 * on every navigation.
 */
export default function OverviewLoading(): ReactElement {
  return (
    <ControlPlaneShell title="Platform admin" active={null}>
      <Stack gap="6">
        <PageHeader title="Platform overview" />

        {/* When the health of the estate was last checked. */}
        <Skeleton lines={1} />

        {/* The two bands of cards: break-glass, then clinics by state. */}
        <Grid cols={2} gap="5">
          {Array.from({ length: 2 }, (_unused, index) => (
            <Card key={index} as="section">
              <Stack gap="5">
                <Skeleton lines={1} />
                {/* The big figure and the paragraph beside it. */}
                <Skeleton block="md" />
              </Stack>
            </Card>
          ))}
        </Grid>
      </Stack>
    </ControlPlaneShell>
  )
}
