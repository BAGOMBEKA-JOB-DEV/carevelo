import { Button, EmptyState, Field, Icon, Input, Notice } from '@carevelo/ui'
import { href } from '../model/links'
import type { Patient, SchedulePaths } from '../model/types'

/**
 * Finding the person on the telephone.
 *
 * ------------------------------------------------------------------------------------
 * THE SEARCH IS IN MEMORY, AND THE SCREEN SAYS SO
 *
 * `GET /v1/patients` accepts exactly one filter — `status` — and nothing else. No name, no
 * phone number, no free-text query. So this screen fetches a page of the registry and filters
 * it in the browser's stead on the server, which is honest for a clinic with a few hundred
 * patients and visibly inadequate for one with ten thousand.
 *
 * WHY THAT IS WRITTEN ON THE SCREEN RATHER THAN HIDDEN. A search box that silently searches
 * one page of a registry is the worst possible version of this: a receptionist types a name,
 * sees nothing, concludes the patient is not registered, and creates a duplicate record. A
 * duplicate patient record is a split clinical history, and merging them is an audited
 * operation somebody has to notice is needed. So the box says what it looked at.
 *
 * THE FIX IS A `q` PARAMETER ON THE PATIENT INDEX, scoped by row-level security exactly as
 * the listing already is. It is in the handover notes.
 *
 * ------------------------------------------------------------------------------------
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No cross-clinic search, and there will not be one — the isolation boundary between clinics
 * is absolute, and a patient of another clinic is not a record this console may know exists.
 * No "create patient" shortcut either: registration is the patients domain's screen and
 * carries the consent capture that a booking flow would be tempted to skip. Booking a patient
 * who is still `pending_consent` is legitimate; skipping the consent record is not.
 */

export type PatientChooserProps = {
  paths: SchedulePaths
  patients: readonly Patient[]
  /** How many the registry page held, before filtering. Shown so the caveat is concrete. */
  scanned: number
  /** Whether the registry has more pages this screen did not read. */
  truncated: boolean
  query: string | undefined
  /** Carried through the links so choosing a patient does not lose the day already picked. */
  carry: Record<string, string | undefined>
}

export function PatientChooser({
  paths,
  patients,
  scanned,
  truncated,
  query,
  carry,
}: PatientChooserProps) {
  const term = (query ?? '').trim().toLowerCase()
  const matches = term === '' ? patients : patients.filter((patient) => matchesTerm(patient, term))

  return (
    <div className="grid" style={{ gap: 'var(--space-5)' }}>
      <div className="card stack" style={{ gap: 'var(--space-4)' }}>
        <h2 className="title">Who is calling?</h2>

        {/* A GET form. Submitting navigates, so the result is a URL a colleague can be sent,
            and it works before any JavaScript has arrived. */}
        <form method="get" action={paths.book} className="row-wrap" style={{ gap: 'var(--space-4)' }}>
          {Object.entries(carry).map(([key, value]) =>
            value === undefined || value === '' ? null : (
              <input key={key} type="hidden" name={key} value={value} />
            ),
          )}

          <div className="grow">
            <Field
              name="q"
              label="Name or phone number"
              hint={
                truncated
                  ? `Searches the ${scanned} patients on the first page of the registry only. `
                    + 'The API has no name filter yet, so a patient further down the registry '
                    + 'will not appear here — check the patients screen before registering '
                    + 'somebody again.'
                  : `Searches all ${scanned} patients registered at this clinic.`
              }
            >
              {(control) => (
                <Input {...control} defaultValue={query ?? ''} autoComplete="off" inputMode="text" />
              )}
            </Field>
          </div>

          <Button variant="primary" type="submit">
            <Icon name="user" /> Find
          </Button>
        </form>
      </div>

      {truncated ? (
        <Notice tone="warn" title="Only part of the registry was read" announce={false}>
          This clinic has more patients than one page of the registry. If the person you are
          looking for is not below, they may still be registered — open the patients screen
          rather than registering them a second time.
        </Notice>
      ) : null}

      {matches.length === 0 ? (
        <EmptyState icon="user" title="Nobody on this page matches">
          {term === ''
            ? 'The registry page came back empty. Register the patient on the patients screen before booking.'
            : `Nothing on the ${scanned} records read matches “${term}”. Check the spelling, or look them up on the patients screen.`}
        </EmptyState>
      ) : null}

      <div className="grid g-2">
        {matches.slice(0, 40).map((patient) => (
          <a
            key={patient.id}
            className="card stack"
            style={{ gap: 'var(--space-2)', minHeight: 'var(--touch-min)' }}
            href={href(paths.book, { ...carry, patient: patient.id })}
          >
            <span style={{ fontWeight: 650 }}>
              {patient.given_name} {patient.family_name}
            </span>
            <span className="fine tnum">{patient.phone}</span>
            {/*
              * `pending_consent` is worth showing at the moment of booking rather than at the
              * moment a note will not save. A record in that state may carry no clinical data
              * at all — enforced in the database, not by this screen — so the clinician who
              * opens the consultation needs to have known before they were in the room.
              */}
            {patient.status !== 'active' ? (
              <span className="fine" style={{ color: 'var(--warn)' }}>
                {patient.status.replace(/_/g, ' ')}
              </span>
            ) : null}
          </a>
        ))}
      </div>
    </div>
  )
}

/**
 * Name or phone, case-insensitively.
 *
 * NOT the national identity number, and not the address. A receptionist searching by NIN is a
 * receptionist reading one out loud in a waiting room, and the number is on the record for
 * identification at the desk rather than as a lookup key.
 */
function matchesTerm(patient: Patient, term: string): boolean {
  const haystack = [patient.given_name, patient.family_name, patient.phone]
    .filter((part): part is string => typeof part === 'string')
    .join(' ')
    .toLowerCase()

  return haystack.includes(term)
}
