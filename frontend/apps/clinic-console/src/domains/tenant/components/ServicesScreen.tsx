import { redirect } from 'next/navigation'
import { Badge, Button, Card, Choice, EmptyState, Field, Input, Money, Notice, Textarea } from '@carevelo/ui'
import { attempt, writeFailure } from '../api/http'
import {
  createService,
  deactivateService,
  listServices,
  reactivateService,
  updateService,
} from '../api/services'
import { priceFromForm, priceProblem, priceToForm } from '../model/price'
import type { ConsultationMode, Service, TenantPaths } from '../model/types'
import { AccessNotice } from './AccessNotice'
import {
  MODE_LABELS,
  MODE_ORDER,
  every,
  samePath,
  text,
  trimmed,
  withParams,
} from './screen'

/**
 * What the clinic offers, and what it charges.
 *
 * ------------------------------------------------------------------------------
 * PRICES ARE THE CLINIC'S AND CAREVELO HAS NO OPINION.
 *
 * There is no platform price list, no recommended fee, no margin and no default. §H1.4 is
 * explicit that a starter catalogue may be offered pre-filled but that "prices are always
 * blank — guessing a clinic's prices would be presumptuous and wrong". So the suggestions
 * below are NAMES ONLY, offered through a `<datalist>` on the name box: a clinic that
 * wants "General consultation" gets it in one keystroke, and nobody is ever shown a number
 * we invented for them.
 *
 * Every amount is integer minor units through `model/price.ts`. A price typed as
 * `20000.50` is REFUSED rather than rounded — see that file for why money that has been
 * through a float cannot be proven correct afterwards.
 *
 * ------------------------------------------------------------------------------
 * "STOP OFFERING", NEVER "DELETE".
 *
 * `DELETE /v1/services/{service}` deactivates; the row survives because appointments, and
 * through them consultations and prescriptions, carry a `service_id`. The wording on the
 * button matches what actually happens, because the difference matters to a clinic asked
 * years later to produce a record — and because an administrator who believes they deleted
 * something will be surprised to find it in an old booking.
 *
 * ------------------------------------------------------------------------------
 * EDITING IS A <details>, NOT A MODAL.
 *
 * Native disclosure: it opens with no JavaScript, it is keyboard-operable for free, and a
 * screen reader announces its state without a line of ARIA. A modal would need a bundle to
 * open, focus trapping to be correct, and an escape hatch for the administrator whose
 * connection dropped mid-edit. This screen has none of those problems because it did not
 * create them.
 */

export type ServicesScreenProps = {
  paths: TenantPaths
  saved?: string | undefined
  problem?: string | undefined
}

/**
 * Names a Ugandan private clinic is likely to want, offered as autocomplete.
 *
 * NAMES ONLY, AND NO PRICES AND NO DURATIONS THAT PRETEND TO BE ADVICE. The three the PRD
 * names, plus the two that follow from the rest of the product. A clinic that offers none
 * of them ignores the list and types its own; nothing here is pre-selected, and the
 * catalogue starts empty rather than starting wrong.
 */
const SUGGESTED_NAMES = [
  'General consultation',
  'Follow-up consultation',
  'Antenatal review',
  'Repeat prescription review',
  'Laboratory results review',
]

export async function ServicesScreen({ paths, saved, problem }: ServicesScreenProps) {
  const result = await attempt(listServices())

  if (!result.ok) {
    return <AccessNotice failure={result} context="this clinic's services" />
  }

  const services = result.value
  const offered = services.filter((service) => service.is_active)
  const withdrawn = services.filter((service) => !service.is_active)

  return (
    <div className="grid">
      {problem === undefined ? null : (
        <Notice tone="bad" title="That was not saved" announce>
          {problem}
        </Notice>
      )}

      {saved === undefined ? null : <Notice tone="info">{saved}</Notice>}

      <Card as="section">
        <span className="eyebrow">Catalogue</span>
        <h2 className="title-sm">
          {offered.length === 0
            ? 'Nothing is bookable yet'
            : `${offered.length} service${offered.length === 1 ? '' : 's'} bookable`}
        </h2>

        {offered.length === 0 ? (
          <EmptyState icon="file" title="No service, no booking">
            A patient books a SERVICE, so until one exists with a price on it there is
            nothing for anybody to book and the clinic cannot be activated. Add the one this
            clinic does most often; the rest can follow.
          </EmptyState>
        ) : (
          <ul className="stack" style={{ gap: 'var(--space-5)' }}>
            {offered.map((service) => (
              <ServiceRow key={service.id} service={service} paths={paths} />
            ))}
          </ul>
        )}
      </Card>

      <Card as="section">
        <span className="eyebrow">Add</span>
        <h2 className="title-sm">A new service</h2>

        <form
          action={addService.bind(null, { selfPath: paths.services })}
          className="stack"
          style={{ gap: 'var(--space-6)', marginTop: 'var(--space-6)' }}
        >
          <Field
            name="name"
            label="Name"
            hint="What a patient will see in the list. Start typing for some common ones."
          >
            {(control) => (
              <>
                <Input {...control} type="text" list="service-names" maxLength={120} required />
                {/* Suggestions, not defaults. The box is empty until somebody types. */}
                <datalist id="service-names">
                  {SUGGESTED_NAMES.map((name) => (
                    <option key={name} value={name} />
                  ))}
                </datalist>
              </>
            )}
          </Field>

          <Field
            name="description"
            label="Description"
            hint="Optional. One line telling a patient whether this is the right appointment for them."
          >
            {(control) => <Textarea {...control} rows={2} maxLength={2000} />}
          </Field>

          <div className="grid g-2">
            <Field
              name="duration_minutes"
              label="Length in minutes"
              hint="Between 5 and 480. This is what decides how many slots fit in a day."
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={480}
                  step={5}
                  required
                />
              )}
            </Field>

            <Field
              name="price"
              label="Price in Ugandan shillings"
              hint="Whole shillings. This clinic's own figure — Carevelo publishes no price list and takes nothing from it."
            >
              {/*
               * DELIBERATELY BLANK, and there is no `defaultValue` to remove later. §H1.4.
               * `type="text"` with a numeric inputMode rather than `type="number"`: a
               * number spinner on a price invites a nudge from 20,000 to 20,001, and a
               * scroll wheel over a focused number input changes it silently.
               */}
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="20000"
                  required
                />
              )}
            </Field>
          </div>

          <Choice
            name="modes"
            id="new-service-modes"
            legend="How this service can be delivered"
            hint="Which of these are safe for this service is a clinical judgement, and it is yours. Voice and chat are proper choices here, not fallbacks."
            multiple
            options={modeOptions()}
            defaultValue={['in_person']}
          />

          <div>
            <Button type="submit" variant="primary">
              Add this service
            </Button>
          </div>
        </form>
      </Card>

      {withdrawn.length === 0 ? null : (
        <Card as="section">
          <span className="eyebrow">Withdrawn</span>
          <h2 className="title-sm">No longer offered</h2>
          <p className="muted">
            These are not bookable and patients cannot see them. They stay here because old
            appointments, consultations and prescriptions point at them — a clinic asked for
            last year&rsquo;s records needs the service to still have a name.
          </p>

          <ul className="stack" style={{ gap: 'var(--space-4)', marginTop: 'var(--space-5)' }}>
            {withdrawn.map((service) => (
              <li key={service.id} className="row between">
                <span className="grow">
                  {service.name} · <Money value={service.price} />
                </span>
                <form action={reoffer.bind(null, { selfPath: paths.services, id: service.id })}>
                  <Button type="submit" variant="quiet">
                    Offer again
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}

/** One bookable service, with its edit form folded away behind a native disclosure. */
function ServiceRow({ service, paths }: { service: Service; paths: TenantPaths }) {
  const modes = service.modes.filter(isConsultationMode)

  return (
    <li className="card card-tight stack" style={{ gap: 'var(--space-4)' }}>
      <div className="row between">
        <div className="grow stack">
          <strong>{service.name}</strong>
          <span className="fine">
            {service.duration_minutes} minutes ·{' '}
            {modes.length === 0
              ? 'no delivery mode chosen'
              : modes.map((mode) => MODE_LABELS[mode]).join(', ')}
          </span>
        </div>
        <span className="row" style={{ gap: 'var(--space-4)' }}>
          <strong className="tnum">
            <Money value={service.price} />
          </strong>
          {service.price.amount_minor === 0 ? <Badge tone="warn">No price</Badge> : null}
        </span>
      </div>

      {service.description ? <p className="muted">{service.description}</p> : null}

      <details>
        <summary className="lnk">Edit this service</summary>

        <form
          action={editService.bind(null, { selfPath: paths.services, id: service.id })}
          className="stack"
          style={{ gap: 'var(--space-5)', marginTop: 'var(--space-5)' }}
        >
          <Field name="name" id={`name-${service.id}`} label="Name">
            {(control) => (
              <Input {...control} type="text" maxLength={120} defaultValue={service.name} required />
            )}
          </Field>

          <Field name="description" id={`description-${service.id}`} label="Description">
            {(control) => (
              <Textarea {...control} rows={2} maxLength={2000} defaultValue={service.description ?? ''} />
            )}
          </Field>

          <div className="grid g-2">
            <Field
              name="duration_minutes"
              id={`duration-${service.id}`}
              label="Length in minutes"
            >
              {(control) => (
                <Input
                  {...control}
                  type="number"
                  inputMode="numeric"
                  min={5}
                  max={480}
                  step={5}
                  defaultValue={service.duration_minutes}
                  required
                />
              )}
            </Field>

            <Field
              name="price"
              id={`price-${service.id}`}
              label="Price in Ugandan shillings"
              hint="Changing this changes what the next patient is asked for. It does not touch an appointment already booked."
            >
              {(control) => (
                <Input
                  {...control}
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  defaultValue={priceToForm(service.price.amount_minor)}
                  required
                />
              )}
            </Field>
          </div>

          <Choice
            name="modes"
            id={`modes-${service.id}`}
            legend="How this service can be delivered"
            multiple
            options={modeOptions()}
            defaultValue={modes}
          />

          <div className="row-wrap">
            <Button type="submit" variant="primary">
              Save changes
            </Button>
          </div>
        </form>

        <form
          action={withdraw.bind(null, { selfPath: paths.services, id: service.id })}
          style={{ marginTop: 'var(--space-5)' }}
        >
          <Button type="submit" variant="danger">
            Stop offering this
          </Button>
          <p className="fine" style={{ marginTop: 'var(--space-2)' }}>
            It disappears from the patient&rsquo;s list immediately. Nothing is deleted, and
            appointments already booked for it are unaffected.
          </p>
        </form>
      </details>
    </li>
  )
}

function modeOptions() {
  return MODE_ORDER.map((mode) => ({ value: mode, label: MODE_LABELS[mode] }))
}

/**
 * Narrow the API's `string[]` to the four modes this console knows about.
 *
 * `ServiceResource.modes` is typed `string[]` rather than the enum, so a mode added to the
 * backend arrives here as a string with no label. Dropping it is better than rendering the
 * raw value: `in_person` on a screen is a leaked identifier, and a clinic reading it learns
 * nothing. It is also what keeps the checkbox group honest — a mode with no checkbox
 * cannot be silently unset by a save, because the save sends the boxes and the API keeps
 * what it validates.
 */
function isConsultationMode(value: string): value is ConsultationMode {
  return (MODE_ORDER as readonly string[]).includes(value)
}

type ServiceContext = { selfPath: string; id?: string }

/** A new service, priced by the clinic and by nobody else. */
async function addService(context: ServiceContext, formData: FormData): Promise<void> {
  'use server'

  const back = samePath(context.selfPath, '/')
  const price = priceFromForm(text(formData, 'price'))

  if (!price.ok) {
    redirect(withParams(back, { problem: priceProblem(price.reason), saved: null }))
  }

  let failure: string | null = null

  try {
    await createService({
      name: trimmed(formData, 'name') ?? '',
      description: trimmed(formData, 'description'),
      duration_minutes: Number(text(formData, 'duration_minutes') ?? '0'),
      price_minor: price.minor,
      modes: every(formData, 'modes').filter(isConsultationMode),
    })
  } catch (error) {
    failure = writeFailure(error, 'adding a service')
  }

  if (failure !== null) {
    redirect(withParams(back, { problem: failure, saved: null }))
  }

  redirect(withParams(back, { saved: 'Service added. Patients can book it now.', problem: null }))
}

/**
 * Change a service.
 *
 * The price is sent on every save because the box is always populated, so `changesPrice()`
 * is always true here — which is correct, and is why the box shows the current price rather
 * than opening blank. A blank price box on an EDIT form would be read as zero by an
 * administrator and as "no change" by the API, and the two readings differ by the entire
 * fee.
 */
async function editService(context: ServiceContext, formData: FormData): Promise<void> {
  'use server'

  const back = samePath(context.selfPath, '/')
  const id = context.id ?? ''
  const price = priceFromForm(text(formData, 'price'))

  if (!price.ok) {
    redirect(withParams(back, { problem: priceProblem(price.reason), saved: null }))
  }

  let failure: string | null = null

  try {
    await updateService(id, {
      name: trimmed(formData, 'name') ?? '',
      description: trimmed(formData, 'description'),
      duration_minutes: Number(text(formData, 'duration_minutes') ?? '0'),
      price_minor: price.minor,
      modes: every(formData, 'modes').filter(isConsultationMode),
    })
  } catch (error) {
    failure = writeFailure(error, 'saving a service')
  }

  if (failure !== null) {
    redirect(withParams(back, { problem: failure, saved: null }))
  }

  redirect(withParams(back, { saved: 'Service saved.', problem: null }))
}

async function withdraw(context: ServiceContext, _formData: FormData): Promise<void> {
  'use server'

  const back = samePath(context.selfPath, '/')
  let failure: string | null = null

  try {
    await deactivateService(context.id ?? '')
  } catch (error) {
    failure = writeFailure(error, 'withdrawing a service')
  }

  if (failure !== null) {
    redirect(withParams(back, { problem: failure, saved: null }))
  }

  redirect(
    withParams(back, {
      saved: 'That service is no longer offered. Its record is kept, so old appointments still read correctly.',
      problem: null,
    }),
  )
}

async function reoffer(context: ServiceContext, _formData: FormData): Promise<void> {
  'use server'

  const back = samePath(context.selfPath, '/')
  let failure: string | null = null

  try {
    await reactivateService(context.id ?? '')
  } catch (error) {
    failure = writeFailure(error, 'restoring a service')
  }

  if (failure !== null) {
    redirect(withParams(back, { problem: failure, saved: null }))
  }

  redirect(withParams(back, { saved: 'That service is bookable again.', problem: null }))
}
