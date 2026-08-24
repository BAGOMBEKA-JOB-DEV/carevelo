import { redirect } from 'next/navigation'
import { Button, Card, Notice, Stack } from '@carevelo/ui'
import { attempt, writeFailure } from '../api/http'
import { getClinic, saveClinic, uploadLogo } from '../api/clinic'
import { colourFromForm } from '../model/colour'
import type { ClinicChanges, TenantPaths } from '../model/types'
import { AccessNotice } from './AccessNotice'
import { BrandingEditor } from './BrandingEditor'
import {
  all,
  clinicName,
  first,
  samePath,
  text,
  trimmed,
  withParams,
  type SearchValue,
} from './screen'

/**
 * The branding editor: trading name, two colours, a logo, and a live preview.
 *
 * ------------------------------------------------------------------------------
 * TWO FORMS AND NOT ONE, ON PURPOSE.
 *
 * The colours go through `PATCH /v1/tenant` as JSON. The logo goes through
 * `POST /v1/tenant/logo` as multipart, because it is a file. Merging them would mean one
 * submission that either sends an empty file part on every colour change — which the
 * backend validates as `required|file` and refuses — or sends the colours again every time
 * somebody replaces a logo. Two endpoints, two forms, two independent things to get right.
 *
 * ------------------------------------------------------------------------------
 * WHERE THE ADVISORIES COME FROM, AND WHY THEY ARRIVE LATE.
 *
 * `contrast_advisories` lives on `TenantAdminResource`, which no GET returns — see
 * `api/clinic.ts` for the full account of that gap. It IS on the body that `PATCH
 * /v1/tenant` answers with, so a save produces them and the redirect carries them back as
 * ordinary search parameters. The consequence, stated on the screen rather than hidden: a
 * clinic that picked pale yellow last month sees the warning the next time it saves, not
 * the moment it opens this page. That is a contract gap and not a design choice, and the
 * one route that would close it is named in `api/clinic.ts`.
 *
 * The advisories themselves come from the API verbatim. `BrandPalette::advisories()`
 * already writes the suggestion into the sentence — "a deeper shade would carry the brand
 * better" — so there is nothing for this screen to add and a paraphrase would only lose
 * the actionable half.
 *
 * ------------------------------------------------------------------------------
 * A PALE COLOUR IS ADVISED AGAINST, NEVER REFUSED. It is the clinic's brand. The portal
 * stays readable either way because the foreground is computed, so refusing the colour
 * outright would be overreach — and a clinic told it may not use its own logo colours is
 * a clinic that stops trusting the product on the first screen.
 */

export type BrandingScreenProps = {
  paths: TenantPaths
  /** From the URL: what a save had to say. See `components/screen.ts`. */
  saved?: SearchValue
  problem?: SearchValue
  advice?: SearchValue
}

export async function BrandingScreen(props: BrandingScreenProps) {
  const { paths } = props
  const saved = first(props.saved)
  const problem = first(props.problem)
  const advice = all(props.advice)

  const result = await attempt(getClinic())

  if (!result.ok) {
    return <AccessNotice failure={result} context="this clinic's branding" />
  }

  const clinic = result.value
  const branding = clinic.branding
  const name = clinicName(clinic)

  return (
    <div className="grid">
      {problem === undefined ? null : (
        <Notice tone="bad" title="That was not saved" announce>
          {problem}
        </Notice>
      )}

      {saved === undefined ? null : <Notice tone="info">{saved}</Notice>}

      {advice.length === 0 ? null : (
        <Notice tone="warn" title="Worth a second look at these colours">
          <ul className="stack">
            {advice.map((sentence) => (
              <li key={sentence}>{sentence}</li>
            ))}
          </ul>
          <p className="fine">
            Your patients will still be able to read every screen — Carevelo picks the text
            colour for contrast. This is about how well the brand carries, not about safety.
          </p>
        </Notice>
      )}

      <Card as="section">
        <span className="eyebrow">Branding</span>
        <h2 className="title-sm">How {name} looks to its patients</h2>
        <p className="muted">
          The patient portal wears your name, your logo and your colours. This console keeps
          Carevelo&rsquo;s — your staff know which software they are using, and your patients
          never need to.
        </p>

        <div style={{ marginTop: 'var(--space-7)' }}>
          <BrandingEditor
            action={saveBranding.bind(null, { selfPath: paths.branding })}
            clinicName={name}
            tradingName={clinic.trading_name ?? ''}
            primary={branding.primary_colour}
            secondary={branding.secondary_colour}
            primaryForeground={branding.primary_foreground}
            secondaryForeground={branding.secondary_foreground}
            surface={branding.surface}
            logoUrl={branding.logo_url}
          />
        </div>
      </Card>

      <Card as="section">
        <Stack gap="5">
          <Stack gap="none">
            <span className="eyebrow">Logo</span>
            <h2 className="title-sm">The mark on the portal, the receipt and the prescription</h2>
          </Stack>

          <form action={saveLogo.bind(null, { selfPath: paths.branding })}>
            <Stack gap="5">
              <div className="field">
                <label className="field__label" htmlFor="logo">
                  Logo image
                </label>
                <p className="field__hint" id="logo-hint">
                  PNG, JPEG or WebP. Between 64 and 2000 pixels on each side, and 512 KB or
                  smaller. Carevelo re-encodes it and strips everything that is not the image —
                  including the location data a phone camera writes into a photograph.
                </p>
                {/*
                 * A bare <input type="file">, because packages/ui has no file control and one
                 * added there would be a component built for a single call site in a single
                 * app. `accept` is a convenience for the picker and never a control: the
                 * declared type is a claim by the uploader, which is exactly why the backend
                 * decodes and re-encodes the bytes rather than trusting it.
                 */}
                <input
                  className="input"
                  id="logo"
                  name="logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  aria-describedby="logo-hint"
                  required
                />
              </div>

              <div className="row-wrap">
                <Button type="submit" variant="primary">
                  Upload logo
                </Button>
                {branding.logo_url ? (
                  <span className="fine">Replacing the current logo. The old file is deleted.</span>
                ) : (
                  <span className="fine">
                    No logo yet. Until there is one, patients see your trading name as a wordmark
                    — which is a perfectly respectable place to start.
                  </span>
                )}
              </div>

            </Stack>
          </form>
        </Stack>
</Card>
    </div>
  )
}

type SaveContext = { selfPath: string }

/**
 * Save the trading name and the two colours.
 *
 * `redirect()` IS CALLED OUTSIDE THE try/catch — it works by throwing, and swallowing that
 * throw would leave the administrator staring at the form they just submitted with no
 * indication that anything had happened.
 *
 * An empty colour box means REMOVE THAT COLOUR and is sent as an explicit `null`, which is
 * the opposite of how the compliance screen treats an empty box. The difference is
 * read-back: `GET /v1/tenant` returns the current colours, so an empty box here is a box
 * the administrator emptied on purpose, while an empty box on the compliance screen is one
 * that was never filled in because the API would not tell us what was in it.
 */
async function saveBranding(context: SaveContext, formData: FormData): Promise<void> {
  'use server'

  const back = samePath(context.selfPath, '/')

  const changes: ClinicChanges = {
    trading_name: trimmed(formData, 'trading_name'),
    primary_colour: colourFromForm(text(formData, 'primary_colour')),
    secondary_colour: colourFromForm(text(formData, 'secondary_colour')),
  }

  let advisories: readonly string[] = []
  let failure: string | null = null

  try {
    const clinic = await saveClinic(changes)
    advisories = clinic.branding.contrast_advisories
  } catch (error) {
    failure = writeFailure(error, 'the branding save')
  }

  if (failure !== null) {
    redirect(withParams(back, { problem: failure, saved: null, advice: null }))
  }

  redirect(
    withParams(back, {
      saved: 'Branding saved. Your patients see it on their next page load.',
      advice: advisories,
      problem: null,
    }),
  )
}

/**
 * Replace the logo.
 *
 * The file arrives as a `File` in the FormData a native form post produced, and goes
 * straight back out as multipart. Nothing here inspects it: dimensions, type and size are
 * the backend's checks, and a second set here would be a second opinion about a claim the
 * uploader made rather than about the bytes.
 *
 * A refused upload keeps onboarding moving. §H1's exception table is explicit that a logo
 * that fails validation should explain the constraint and offer to proceed with a text
 * wordmark — which is what the clinic already has, so the message says so.
 */
async function saveLogo(context: SaveContext, formData: FormData): Promise<void> {
  'use server'

  const back = samePath(context.selfPath, '/')
  const file = formData.get('logo')

  if (!(file instanceof File) || file.size === 0) {
    redirect(
      withParams(back, {
        problem: 'Choose an image file to upload.',
        saved: null,
        advice: null,
      }),
    )
  }

  const result = await uploadLogo(file)

  if (!result.ok) {
    redirect(
      withParams(back, {
        problem: `${result.message} Until a logo is uploaded, patients see your trading name as a wordmark.`,
        saved: null,
        advice: null,
      }),
    )
  }

  redirect(
    withParams(back, {
      saved: 'Logo uploaded. It now appears on the portal, on receipts and on prescriptions.',
      // The logo endpoint returns the same administrator resource, so the advisories are
      // current and worth carrying even though no colour changed — a clinic that uploads a
      // logo months after picking its colours should still be told about them.
      advice: result.clinic.branding.contrast_advisories,
      problem: null,
    }),
  )
}
