import type { CSSProperties } from 'react'
import { Inline, Stack } from '@carevelo/ui'
import { swatch } from '../model/colour'

/**
 * A picture of the patient-facing surface, in this clinic's colours.
 *
 * ------------------------------------------------------------------------------
 * WHY THIS EXISTS. §H1.2: "A live preview of the patient-facing surface shows the effect
 * immediately, because this is the moment the administrator decides whether the product is
 * credible." A colour picker with no preview asks somebody to imagine a portal they have
 * never seen; the whole proposition of a white-label product is that the patient deals
 * with their clinic and not with a stranger, and this is where the clinic's owner finds
 * out whether that is true.
 *
 * ------------------------------------------------------------------------------
 * THIS IS THE ONE PLACE ON A STAFF SURFACE WHERE --brand-* IS CORRECT.
 *
 * The console is Carevelo's: staff know they use Carevelo, the clinic is the customer
 * rather than the audience, and console chrome takes `--primary`. That rule is not
 * suspended here — it is satisfied. What this element paints is not console chrome; it is
 * a rendering of the PATIENT portal, where the clinic's colours are the product. So the
 * tokens are set on this subtree and on nothing outside it, and the surrounding page stays
 * Carevelo's throughout.
 *
 * ------------------------------------------------------------------------------
 * AND IT DOES NO COLOUR MATHS. NONE.
 *
 * `primaryForeground` is `#FFFFFF` or `#000000`, computed once by `BrandPalette` on the
 * server and carried on the resource. This component NEVER derives one. When the
 * administrator types a colour that has not been saved yet, the foreground on screen is
 * still the one belonging to the SAVED colour — which is why `BrandingEditor` prints a
 * line saying the text colour is chosen for readability when the colour is saved. A
 * preview that guessed would be at its most confident and most wrong on exactly the case
 * the preview exists for: the pale yellow that needs black text where the old colour
 * needed white.
 *
 * The tokens are applied as a React `style` OBJECT, and that is the ONE style property on
 * this component that must never become a class. React sets these through the CSSOM, so no
 * tenant value is ever concatenated into a `<style>` block or handed to
 * `dangerouslySetInnerHTML` — there is no string for a hostile value to break out of.
 * Combined with `swatch()` re-validating every hex and the API refusing to store a non-hex
 * value at all, that is three independent reasons a colour cannot become a script. A CSS
 * class cannot hold a per-tenant value at all, which is exactly why the values that VARY
 * stay here and the rules that merely READ them moved out.
 *
 * ------------------------------------------------------------------------------
 * WHERE THE PAINTING ACTUALLY LIVES NOW.
 *
 * The layout used to be written out here as a dozen inline styles — a header row, a body,
 * an offer card, two pretend buttons. Those are not per-tenant values; they are a picture
 * of the portal, and console.css section 15 was written to hold it. Two consequences worth
 * stating, because they are the reason this is better rather than merely tidier:
 *
 *   1. The header wears `.site-brand`, `.site-brand__mark`, `.site-brand__text` and
 *      `.site-brand__sub` — the REAL classes the REAL portal header wears, from site.css.
 *      A preview built from its own private copy of those rules drifts away from the thing
 *      it is a preview of the first time the portal header changes, and nobody finds out,
 *      because the only person who would notice is a clinic administrator who has never
 *      seen the portal.
 *
 *      AND THAT IS EXACTLY WHAT HAD HAPPENED. This claim used to name `.site__header` and
 *      `.site__logo`, with the same reasoning, and those are not the portal's classes —
 *      they are a second, older portal frame in layout.css, one hyphen away from the real
 *      one. The real header is SiteHeader wearing `.site-header` and `.site-brand`.
 *      Nothing else in the repo renders `.site__header` at all, so this component was the
 *      sole surviving consumer of a parallel vocabulary and was keeping it alive; and
 *      `/settings/branding` is not in the visual baselines, so no test had an opinion
 *      either. The preview had drifted in precisely the way this comment promised it
 *      could not.
 *
 *      IT ALSO PAINTED THE WRONG THING. `.site__header` fills its whole width with
 *      --brand-primary. The real portal header does not: it is transparent over the hero
 *      and near-opaque canvas once scrolled, and the clinic's colour appears in the
 *      monogram tile and on the primary button — nowhere else. An administrator choosing a
 *      colour was shown a full band of it that no patient ever sees, on the one screen
 *      whose whole purpose is to show them what patients see.
 *   2. `.btn-brand` already paints `--brand-primary` with `--brand-primary-fg` on it. This
 *      file was restating both inline, which is a second place for that pairing to be got
 *      wrong. There is now one.
 *
 * Nothing about the --brand-* rule changes: those classes read the tokens set on this
 * subtree by the object above, and they reach nothing outside it.
 */

export type PortalPreviewProps = {
  clinicName: string
  primary: string | null | undefined
  primaryForeground: string | null | undefined
  secondary: string | null | undefined
  secondaryForeground: string | null | undefined
  surface: string | null | undefined
  logoUrl: string | null | undefined
}

export function PortalPreview({
  clinicName,
  primary,
  primaryForeground,
  secondary,
  secondaryForeground,
  surface,
  logoUrl,
}: PortalPreviewProps) {
  const tokens: Record<string, string> = {}
  const set = (property: string, value: string | null | undefined) => {
    const hex = swatch(value)

    if (hex !== undefined) {
      tokens[property] = hex
    }
  }

  /*
   * A value that fails validation is DROPPED, not defaulted and not passed through — the
   * same rule `resolveBrandTokens` follows. Dropping it means the stylesheet's own
   * fallback applies and that part of the preview renders in Carevelo's colours, which is
   * visibly wrong to whoever is configuring it. That is the right failure. A
   * partially-applied palette that looks deliberate is not.
   */
  set('--brand-primary', primary)
  set('--brand-primary-fg', primaryForeground)
  set('--brand-secondary', secondary)
  set('--brand-secondary-fg', secondaryForeground)
  set('--brand-surface', surface)

  return (
    <div
      className="card preview"
      // The preview is decorative in the accessibility tree's sense: everything inside it
      // is repeated as real, readable text in the form beside it, and a screen-reader user
      // gains nothing from tabbing through a picture of a button they cannot press.
      role="img"
      aria-label={`Preview of the patient portal for ${clinicName}`}
      // THE SURVIVOR, AND THE ONLY ONE THAT MATTERS. This is the clinic's palette, and it
      // has to be an object rather than a class or a string: see the note at the top of the
      // file. Everything the tokens are READ by is a class; the tokens themselves cannot be.
      style={tokens as CSSProperties}
    >
      {/* The portal's own brand row, in the state it wears on a scrolled page: canvas
          ground, a hairline under it, and the clinic's colour carried by the monogram —
          which is where a patient actually meets it. A <span> rather than the <a> the
          portal uses, because this subtree is `role="img"` and a link inside a picture of
          a page is a link to nowhere. */}
      <div className="preview__header">
        <span className="site-brand">
          {logoUrl ? (
            /*
             * A plain <img>, deliberately — the same call ConsoleShell and the real
             * SiteHeader both make, and for the same reasons. next/image would route a
             * TENANT-UPLOADED asset through Next's optimiser: more client JavaScript, and a
             * second cache layer over an image the backend already validated, re-encoded,
             * stripped of metadata and served from tenant-partitioned storage. There is
             * nothing left for the optimiser to do.
             *
             * The 34px cap matches SiteHeader's exactly. It is a constraint on an image of
             * unknown dimensions rather than a layout decision, which is why it is inline
             * in both places and why both files are allow-listed for it.
             */
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" style={{ maxHeight: 34, width: 'auto' }} />
          ) : (
            // No logo yet: the clinic's initial on the clinic's colour, with the
            // foreground the API computed for contrast against it. Same fallback the real
            // header takes, for the same reason.
            <span className="site-brand__mark" aria-hidden="true">
              {clinicName.slice(0, 1).toUpperCase()}
            </span>
          )}
          <span className="site-brand__text">
            <span>{clinicName}</span>
            {/* The portal's own tagline, from its en.json. Hard-coded because the console is
                English by written policy and does not load the portal's catalogue — and a
                preview showing a DIFFERENT tagline than the portal would be the same class
                of drift this component has just come out of. */}
            <span className="site-brand__sub">Book · Consult · Collect</span>
          </span>
        </span>
      </div>

      <div className="preview__body">
        {/* The nesting is the two spacings that were here as margins: 8px under the little
            label that names the section, 16px between the offer and the buttons under it. */}
        <Stack gap="5">
          <Stack gap="3">
            <p className="fine">Book a consultation</p>

            <div className="preview__offer">
              {/*
                SURVIVING INLINE STYLE, AND IT SURVIVES BECAUSE OF WHERE IT IS RATHER THAN
                WHAT IT SETS.

                Everything inside this element is a PICTURE OF THE PATIENT PORTAL, drawn on a
                staff screen so an administrator can see what their patients will see. The
                console's own type classes are console chrome — `.control-label` and
                `.signatory` next door are 600 for reasons about clinical forms — and reaching
                for one here would tie a picture of the portal to a scale the console is free
                to change underneath it. The day somebody retunes `.control-label` for a
                checkbox, this mock would move with it and nobody would connect the two.

                It is not `<strong>` either: this subtree is inside `role="img"`, so the
                emphasis would be announced to nobody while costing a visible jump to 700.

                A `.preview__offer-name` beside `.preview__offer` in console.css is available
                and is probably where this ends up; it is left as one declaration on one line
                here so the whole mock reads as one block, which is the argument the file's
                own header makes for `role="img"` in the first place. Named in the report.
              */}
              <p style={{ fontWeight: 600 }}>General consultation</p>
              {/* A price with no figure in it. This is a picture of a layout, and inventing a
                  number here would be inventing a price for a clinic that has not set one. */}
              <p className="fine">30 minutes · at the clinic or by voice call</p>
            </div>
          </Stack>

          <Inline gap="4">
            {/* `.btn-brand` already pairs --brand-primary with the foreground the server
                computed for it, so neither is restated here. `.preview__control` is what
                stops the cursor and the hover state promising a button that cannot be
                pressed — these are inside an element with `role="img"`. */}
            <span className="btn btn-brand preview__control">Choose a time</span>
            <span className="btn preview__control preview__control--secondary">
              My appointments
            </span>
          </Inline>
        </Stack>
      </div>
    </div>
  )
}
