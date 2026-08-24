'use client'

import { useState } from 'react'
import { Button, Field, Input, Stack } from '@carevelo/ui'
import { HEX_PATTERN } from '../model/colour'
import { PortalPreview } from './PortalPreview'

/**
 * The colour form and the preview beside it, as one component.
 *
 * ------------------------------------------------------------------------------
 * WHY THIS IS THE ONLY 'use client' IN THE DOMAIN, AND WHY IT EARNS IT.
 *
 * Server components are the default across this product and the rest of this domain holds
 * to it: nine screens, every form a native post, no bundle required to change a price or
 * invite a colleague. This one is different because of what §H1.2 actually asks for — a
 * preview that "shows the effect IMMEDIATELY, because this is the moment the administrator
 * decides whether the product is credible". A preview that only updates after a round trip
 * is not that. It is a save button with a picture next to it, and the clinic owner deciding
 * whether to trust this software would be looking at the old colours while typing the new
 * ones.
 *
 * ------------------------------------------------------------------------------
 * AND IT DEGRADES COMPLETELY.
 *
 * Every input below is UNCONTROLLED — `defaultValue`, never `value` — so with no
 * JavaScript at all this is an ordinary form that posts natively and saves correctly. What
 * is lost without the bundle is the live update and nothing else: the preview still
 * renders, in the colours the clinic has actually saved, which is a true statement about
 * the portal either way. That ordering matters on a mid-range Android on variable mobile
 * data: the screen is useful before the bundle arrives and better afterwards, rather than
 * broken until it does.
 *
 * `onChange` on an uncontrolled input is the whole mechanism. There is no controlled-input
 * round trip, no form library, no state synchronisation to get wrong — React reads the
 * value the browser already has and the preview re-renders.
 *
 * ------------------------------------------------------------------------------
 * A TEXT BOX RATHER THAN <input type="color">.
 *
 * A clinic's brand colour is a known quantity — "our green is #1B7F5A", off a brand sheet
 * or an invoice — and typing six digits into a box is faster and more accurate than
 * hunting for a shade in an operating-system colour dialog. `pattern` gives the browser's
 * own validation without a line of script, and the API's message ("Enter a colour as six
 * hexadecimal digits, for example #1B7F5A") covers what the browser lets through. A native
 * picker would also make "no secondary colour" inexpressible, and a clinic mid-onboarding
 * legitimately has one colour and not the other.
 *
 * ------------------------------------------------------------------------------
 * THE FOREGROUNDS ARE NOT TOUCHED.
 *
 * Text colour on a brand background is computed server-side for WCAG AA and never chosen.
 * The preview keeps the SAVED foregrounds while a new colour is being typed, and says so
 * in a line under it, because the alternative is deriving one here — a second
 * implementation of the contrast maths, free to disagree with the first, on the question
 * "is this readable". See `model/colour.ts`.
 */

export type BrandingEditorProps = {
  /** The server action this form posts to. Bound in the screen; opaque here. */
  action: (formData: FormData) => void | Promise<void>
  clinicName: string
  tradingName: string
  primary: string | null
  secondary: string | null
  /** Computed server-side. Held constant while a colour is being typed — see above. */
  primaryForeground: string | null
  secondaryForeground: string | null
  surface: string | null
  logoUrl: string | null
  /** The API's own field message from a refused save, if there was one. */
  primaryError?: string | undefined
  secondaryError?: string | undefined
}

export function BrandingEditor({
  action,
  clinicName,
  tradingName,
  primary,
  secondary,
  primaryForeground,
  secondaryForeground,
  surface,
  logoUrl,
  primaryError,
  secondaryError,
}: BrandingEditorProps) {
  const [livePrimary, setLivePrimary] = useState(primary ?? '')
  const [liveSecondary, setLiveSecondary] = useState(secondary ?? '')
  const [liveName, setLiveName] = useState(tradingName)

  /*
   * The surface tint is DERIVED FROM THE PRIMARY, server-side, and the derivation is not
   * repeated here. While an unsaved colour is being typed the tint therefore belongs to
   * the old one — so it is dropped rather than shown wrong, and the preview falls back to
   * the stylesheet's own value for that one token. A pale tint of the previous brand,
   * presented beside the new brand, is the kind of small lie that makes somebody distrust
   * the whole screen.
   */
  const changed = livePrimary !== (primary ?? '')

  return (
    <div className="grid g-2">
      {/* A `<form>` is not a Stack element — the union stops at the elements that are
          layout — so the column the fields sit in goes inside it. */}
      <form action={action}>
        <Stack gap="6">
          <Field
            name="trading_name"
            label="Trading name"
            hint="What patients see, on the portal, on receipts and at the top of a prescription."
          >
            {(control) => (
              <Input
                {...control}
                type="text"
                maxLength={120}
                defaultValue={tradingName}
                onChange={(event) => setLiveName(event.currentTarget.value)}
              />
            )}
          </Field>

          <Field
            name="primary_colour"
            label="Primary colour"
            hint="Six hexadecimal digits, for example #1B7F5A. Leave it empty to use no colour of your own."
            error={primaryError}
          >
            {(control) => (
              <Input
                {...control}
                type="text"
                inputMode="text"
                spellCheck={false}
                autoCapitalize="none"
                pattern={HEX_PATTERN}
                placeholder="#1B7F5A"
                defaultValue={primary ?? ''}
                onChange={(event) => setLivePrimary(event.currentTarget.value)}
              />
            )}
          </Field>

          <Field
            name="secondary_colour"
            label="Secondary colour"
            hint="Used for the quieter of the two patient-facing actions."
            error={secondaryError}
          >
            {(control) => (
              <Input
                {...control}
                type="text"
                inputMode="text"
                spellCheck={false}
                autoCapitalize="none"
                pattern={HEX_PATTERN}
                placeholder="#0F5FA8"
                defaultValue={secondary ?? ''}
                onChange={(event) => setLiveSecondary(event.currentTarget.value)}
              />
            )}
          </Field>

          <div>
            <Button type="submit" variant="primary">
              Save branding
            </Button>
          </div>
        </Stack>
      </form>

      <Stack gap="4">
        <span className="eyebrow">What your patients will see</span>

        <PortalPreview
          clinicName={liveName.trim() === '' ? clinicName : liveName}
          primary={livePrimary}
          secondary={liveSecondary}
          primaryForeground={primaryForeground}
          secondaryForeground={secondaryForeground}
          surface={changed ? null : surface}
          logoUrl={logoUrl}
        />

        <p className="fine">
          Text colour on your brand is chosen for readability when you save, not by you —
          a colour that would leave patients squinting at a dosage instruction gets dark
          text instead of light. Until you save, this preview keeps the text colour that
          belongs to your current brand.
        </p>
      </Stack>
    </div>
  )
}
