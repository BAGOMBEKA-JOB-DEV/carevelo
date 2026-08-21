import type { CSSProperties } from 'react'
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
 * The tokens are applied as a React `style` OBJECT. React sets these through the CSSOM, so
 * no tenant value is ever concatenated into a `<style>` block or handed to
 * `dangerouslySetInnerHTML` — there is no string for a hostile value to break out of.
 * Combined with `swatch()` re-validating every hex and the API refusing to store a non-hex
 * value at all, that is three independent reasons a colour cannot become a script.
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
      className="card"
      // The preview is decorative in the accessibility tree's sense: everything inside it
      // is repeated as real, readable text in the form beside it, and a screen-reader user
      // gains nothing from tabbing through a picture of a button they cannot press.
      role="img"
      aria-label={`Preview of the patient portal for ${clinicName}`}
      style={{ ...(tokens as CSSProperties), padding: 0, overflow: 'hidden' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-4)',
          padding: 'var(--space-5) var(--space-6)',
          background: 'var(--brand-primary)',
          color: 'var(--brand-primary-fg)',
        }}
      >
        {logoUrl ? (
          /*
           * A plain <img>, deliberately — the same call ConsoleShell makes and for the
           * same reasons. next/image would route a TENANT-UPLOADED asset through Next's
           * optimiser: more client JavaScript, and a second cache layer over an image the
           * backend already validated, re-encoded, stripped of metadata and served from
           * tenant-partitioned storage. There is nothing left for the optimiser to do.
           */
          // eslint-disable-next-line @next/next/no-img-element
          <img src={logoUrl} alt="" style={{ maxHeight: 32, width: 'auto' }} />
        ) : null}
        <span style={{ fontFamily: 'var(--head)', fontWeight: 700, fontSize: 17 }}>
          {clinicName}
        </span>
      </div>

      <div style={{ padding: 'var(--space-6)', background: 'var(--surface)' }}>
        <p className="fine" style={{ marginBottom: 'var(--space-3)' }}>
          Book a consultation
        </p>

        <div
          style={{
            background: 'var(--brand-surface)',
            border: '1px solid var(--hairline-soft)',
            borderRadius: 'var(--r-md)',
            padding: 'var(--space-5)',
          }}
        >
          <p style={{ fontWeight: 600 }}>General consultation</p>
          {/* A price with no figure in it. This is a picture of a layout, and inventing a
              number here would be inventing a price for a clinic that has not set one. */}
          <p className="fine">30 minutes · at the clinic or by voice call</p>
        </div>

        <div className="row-wrap" style={{ marginTop: 'var(--space-5)' }}>
          <span
            className="btn btn-brand"
            style={{
              background: 'var(--brand-primary)',
              color: 'var(--brand-primary-fg)',
              pointerEvents: 'none',
            }}
          >
            Choose a time
          </span>
          <span
            className="btn"
            style={{
              background: 'var(--brand-secondary)',
              color: 'var(--brand-secondary-fg)',
              pointerEvents: 'none',
            }}
          >
            My appointments
          </span>
        </div>
      </div>
    </div>
  )
}
