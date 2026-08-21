import { redirect } from 'next/navigation'
import { Button, Card, Field, Grid, Inline, Input, Notice, PageHeader, Select, Stack } from '@carevelo/ui'
import { provisionTenant } from '../api/tenants'
import { decodeFieldErrors, encodeFieldErrors } from '../model/formErrors'
import { href } from '../model/links'
import { TRIAL_OPTIONS, trialEndsAt } from '../model/trial'
import type { PlatformPaths, ProvisionBody } from '../model/types'

/**
 * Provisioning a clinic.
 *
 * ============================================================
 * THIS CREATES A CLINIC. IT DOES NOT OPEN ONE.
 * ============================================================
 *
 * `StoreTenantRequest` has no `status` field, deliberately: "A tenant is created in
 * `provisioning` and moves on only through TenantStatus, so a client cannot post an
 * already-active clinic into existence." There is therefore no switch on this form, or
 * anywhere in this app, that opens a clinic for business.
 *
 * What opens it is the clinic's own checklist — branding, at least one bookable service
 * with the clinic's own price, at least one registered clinician, consent text, its
 * compliance references, colleagues invited, and its own mobile-money account. Seven gates,
 * and Carevelo completes none of them. The form says this before the operator starts
 * typing, because the commonest support question after a provisioning is "why is it not
 * live yet".
 *
 * ============================================================
 * THE SUBDOMAIN IS THE FIELD TO GET RIGHT
 * ============================================================
 *
 * It appears in patient-facing URLs, in the aggregator's webhook configuration and on
 * printed materials, and it is IMMUTABLE afterwards. The contract spells out the
 * consequence: a clinic that claims `api` or `admin` "does not merely have an awkward name,
 * it shadows a platform host."
 *
 * WHICH NAMES ARE REFUSED IS NOT RESTATED HERE. The API holds that list and a copy in this
 * file would be a second list free to disagree with the first — and the failure mode of
 * disagreeing is either a name accepted here and refused there, or a name this form blocks
 * that was perfectly fine. The field warns; the API decides.
 *
 * ============================================================
 * THE ATTESTATIONS ARE THE CLINIC'S CLAIM AND NOTHING MORE
 * ============================================================
 *
 * Carevelo has no access to the UMDPC or NDA registers. `PlatformTenantResource` carries
 * `verified_by_carevelo: false` and every screen that shows these values says so. Typing one
 * into this form records a claim; it checks nothing, and a form that implied otherwise would
 * be the start of somebody relying on it.
 *
 * ============================================================
 * A REJECTED FORM COMES BACK EMPTY, ON PURPOSE
 * ============================================================
 *
 * See model/formErrors.ts. The API's sentence for each wrong field travels back; the values
 * do not, because carrying a clinic's contact telephone number and email address through a
 * query string writes them into every log between here and the browser. The notice on the
 * form says so rather than leaving an operator to think it is broken.
 */
export type ProvisionScreenProps = {
  paths: PlatformPaths
  /** `?problem=` — what the last attempt did. */
  problem?: string | undefined
  /** `?message=` — the API's own overall sentence. */
  message?: string | undefined
  /** `?fields=` — the API's per-field sentences, JSON. See model/formErrors.ts. */
  fields?: string | undefined
}

/** The trial choices that make sense for a clinic that does not exist yet. */
const NEW_TRIAL_OPTIONS = TRIAL_OPTIONS.filter((option) => option.value !== 'keep')

export function ProvisionScreen({ paths, problem, message, fields }: ProvisionScreenProps) {
  const errors = decodeFieldErrors(fields)

  async function provision(formData: FormData) {
    'use server'

    const text = (name: string) => String(formData.get(name) ?? '').trim()

    const legalName = text('legal_name')
    const subdomain = text('subdomain')

    /*
     * Only the two fields the contract marks required are checked here, and only for
     * presence. Everything else about them — is this subdomain taken, does it shadow a
     * platform host, is this a plausible Ugandan district — is the API's to decide, and a
     * second opinion in this file would be a rule free to disagree with the real one.
     */
    if (legalName === '' || subdomain === '') {
      return redirect(href(paths.provision, { problem: 'incomplete' }))
    }

    /*
     * Built field by field rather than spread from the form, because
     * exactOptionalPropertyTypes distinguishes an absent property from one explicitly set
     * to undefined — and `BaseRequest::rejectUnknownFields()` on the API refuses anything it
     * does not recognise, so a stray key is a 422 rather than a field quietly ignored.
     *
     * An empty optional text field is omitted rather than sent as an empty string: "" and
     * null are different claims about a clinic's district, and only one of them is true.
     */
    const body: ProvisionBody = { legal_name: legalName, subdomain }

    const optional: readonly (keyof ProvisionBody)[] = [
      'trading_name',
      'contact_phone',
      'contact_email',
      'physical_address',
      'district',
      'umdpc_facility_reference',
      'nda_licence_reference',
    ]

    for (const key of optional) {
      const value = text(key)

      if (value !== '') {
        // Every one of these is `string | null | undefined` on the request type, so the
        // assignment is safe for the whole list and does not need narrowing per field.
        Object.assign(body, { [key]: value })
      }
    }

    const trial = trialEndsAt(text('trial'))

    if (trial !== undefined) {
      body.trial_ends_at = trial
    }

    const outcome = await provisionTenant(body)

    if (outcome.kind === 'problem') {
      return redirect(
        href(paths.provision, {
          problem: outcome.problem,
          message: outcome.message ?? undefined,
          fields: encodeFieldErrors(outcome.fields),
        }),
      )
    }

    // Straight to the register, with the new clinic named. The confirmation belongs beside
    // the list it just changed rather than on the form, which an operator has finished with.
    return redirect(href(paths.register, { provisioned: outcome.tenant.subdomain }))
  }

  return (
    <>
      <PageHeader
        title="Provision a clinic"
        description={
          <>
            Creates the clinic in <code>provisioning</code>. It does not open it — the clinic
            completes its own checklist and becomes active that way.
          </>
        }
        actions={
          <Button variant="quiet" href={paths.register}>
            Back to the register
          </Button>
        }
      />

      <Stack gap="6">
        {problem === 'incomplete' ? (
          <Notice tone="warn" title="Two fields are required">
            A clinic needs a legal name and a subdomain. Nothing was created.
          </Notice>
        ) : null}

        {problem === 'invalid' ? (
          <Notice tone="warn" title="The API refused these details">
            {message ?? 'Check the fields marked below.'}
          </Notice>
        ) : null}

        {problem === 'refused' ? (
          <Notice tone="warn" icon="lock" title="Refused">
            {message ?? 'This account may not provision clinics. That needs platform_admin.'}
          </Notice>
        ) : null}

        {problem === 'failed' ? (
          <Notice tone="bad" title="Nothing was created">
            {message
              ?? 'The request did not complete, and the API gave no reason this screen can '
                + 'pass on. No clinic was created.'}
          </Notice>
        ) : null}

        <Notice tone="info" icon="help" title="What happens after this form">
          The clinic is created in <code>provisioning</code> and becomes active only once it
          has its branding, at least one bookable service at its own price, at least one
          registered clinician, its consent text, its compliance references, colleagues
          invited and its own mobile-money account. Carevelo completes none of those. There
          is no control on this surface that skips them.
        </Notice>

        <Card as="section">
          <form action={provision}>
            <Stack gap="7">
              {problem !== undefined && problem !== '' ? (
                <p className="muted">
                  This form does not keep what you typed when the API refuses it. That is
                  deliberate: this surface ships no JavaScript, and carrying a clinic&rsquo;s
                  contact details back through a URL would write them into every log between
                  here and your browser.
                </p>
              ) : null}

              <Field
                name="legal_name"
                label="Registered legal name"
                hint="Exactly as it appears on the clinic's registration. Required."
                error={errors['legal_name']}
              >
                {(control) => <Input {...control} type="text" required autoComplete="off" />}
              </Field>

              <Field
                name="trading_name"
                label="Trading name"
                hint="What patients call it, if that differs from the legal name."
                error={errors['trading_name']}
              >
                {(control) => <Input {...control} type="text" autoComplete="off" />}
              </Field>

              <Field
                name="subdomain"
                label="Subdomain"
                hint={
                  'Required, and IMMUTABLE once created. It goes into patient-facing URLs, '
                  + "into the aggregator's webhook configuration and onto printed materials — "
                  + 'and a name like "api" or "admin" would shadow a platform host. Which '
                  + 'names are refused is the API’s decision, not this form’s.'
                }
                error={errors['subdomain']}
              >
                {(control) => (
                  <Input
                    {...control}
                    type="text"
                    required
                    autoComplete="off"
                    inputMode="url"
                    spellCheck={false}
                  />
                )}
              </Field>

              <Grid cols={2} gap="5">
                <Field
                  name="contact_phone"
                  label="Contact telephone"
                  hint="Normalised to +256… on write."
                  error={errors['contact_phone']}
                >
                  {(control) => <Input {...control} type="tel" inputMode="tel" autoComplete="off" />}
                </Field>

                <Field name="contact_email" label="Contact email" error={errors['contact_email']}>
                  {(control) => <Input {...control} type="email" autoComplete="off" />}
                </Field>
              </Grid>

              <Grid cols={2} gap="5">
                <Field
                  name="physical_address"
                  label="Physical address"
                  error={errors['physical_address']}
                >
                  {(control) => <Input {...control} type="text" autoComplete="off" />}
                </Field>

                <Field name="district" label="District" error={errors['district']}>
                  {(control) => <Input {...control} type="text" autoComplete="off" />}
                </Field>
              </Grid>

              {/* The <legend> must be the fieldset's FIRST child for a browser to associate it
                  with the group, so the Stack wraps what follows it rather than the whole
                  fieldset. A legend nested inside another element is a group with no name. */}
              <fieldset>
                <legend className="field__label">Compliance references</legend>
                <Stack gap="5">
                <Notice tone="warn" icon="shield" title="Recorded, never verified">
                  Carevelo has no access to the UMDPC or NDA registers and never presents these
                  as checked. Typing one here records the clinic&rsquo;s own claim and
                  validates nothing. Every screen that shows them says the same.
                </Notice>

                <Field
                  name="umdpc_facility_reference"
                  label="UMDPC facility reference"
                  error={errors['umdpc_facility_reference']}
                >
                  {(control) => <Input {...control} type="text" autoComplete="off" />}
                </Field>

                <Field
                  name="nda_licence_reference"
                  label="NDA pharmacy licence reference"
                  error={errors['nda_licence_reference']}
                >
                  {(control) => <Input {...control} type="text" autoComplete="off" />}
                </Field>
                </Stack>
              </fieldset>

              <Field
                name="trial"
                label="Trial"
                hint={
                  'The trial date and the lifecycle state are the whole commercial model on '
                  + 'this platform. There is no plan, no price and no invoice on any endpoint.'
                }
                error={errors['trial_ends_at']}
              >
                {(control) => (
                  <Select {...control} defaultValue="none">
                    {NEW_TRIAL_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Inline gap="4">
                <Button type="submit" variant="primary" size="lg">
                  Provision this clinic
                </Button>
                <a className="lnk" href={paths.register}>
                  Cancel
                </a>
              </Inline>
            </Stack>
          </form>
        </Card>
      </Stack>
    </>
  )
}
