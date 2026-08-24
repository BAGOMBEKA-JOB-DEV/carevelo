import type { ReactElement } from 'react'
import { Card, Skeleton, Stack } from '@carevelo/ui'

/**
 * Settings, in the shape it will arrive in.
 *
 * ------------------------------------------------------------------------------------
 * THIS IS THE ONE console FALLBACK THAT RENDERS NO SHELL, AND THE REASON IS `settings/
 * layout.tsx`, NOT A CHANGE OF MIND.
 *
 * Every other route in this app renders `ConsoleShell` from its page, so its `loading.tsx`
 * has to render the shell too or the console blinks its own navigation out on every
 * navigation. This subtree is the exception the layout's own docblock sets out: every route
 * under `settings/` IS the settings section, so the value a layout cannot guess is a
 * constant here and the shell was hoisted into the layout to save seven fetches of the same
 * logo.
 *
 * A `loading.tsx` renders INSIDE the layout at its own level — Next wraps the page, not the
 * layout, in the Suspense boundary — so the sidebar, the topbar, the tab bar AND the
 * "Settings" page head are all already on screen, rendered by the layout, while this is
 * showing. Rendering `ConsoleShell` here would nest a second console inside the first.
 *
 * It also means this fallback needs no heading of its own: the layout's <h1> is standing
 * above it the whole time.
 * ------------------------------------------------------------------------------------
 *
 * THE SHAPE IS DELIBERATELY GENERIC, because this one fallback covers seven screens —
 * branding, compliance, hours, payments, services, staff and one staff member. A heading, a
 * body and a control area is what all seven share; claiming more would mean promising a
 * form on the screens that are a table.
 */
export default function SettingsLoading(): ReactElement {
  return (
    <Stack gap="6">
      {/* The row of links across the settings screens. */}
      <Skeleton lines={1} />

      {Array.from({ length: 3 }, (_unused, index) => (
        <Card key={index} as="section">
          <Stack gap="4">
            <Skeleton lines={1} />
            <Skeleton block="md" />
          </Stack>
        </Card>
      ))}
    </Stack>
  )
}
