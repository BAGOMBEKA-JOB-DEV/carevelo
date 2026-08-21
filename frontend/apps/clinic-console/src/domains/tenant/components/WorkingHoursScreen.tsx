import { redirect } from 'next/navigation'
import { Button, Card, Notice } from '@carevelo/ui'
import { attempt, writeFailure } from '../api/http'
import { listWorkingHours, replaceWorkingHours } from '../api/workingHours'
import { WEEK, byDay, opensAtAll, toTimeInput, weekFromForm } from '../model/week'
import type { TenantPaths } from '../model/types'
import { AccessNotice } from './AccessNotice'
import { samePath, text, withParams } from './screen'

/**
 * When the clinic is open.
 *
 * ------------------------------------------------------------------------------
 * THIS SCREEN DECIDES WHETHER ANY PATIENT CAN BOOK ANYTHING.
 *
 * `GET /v1/availability` generates slots from these rows. A clinic with a full catalogue,
 * a registered clinician and no open day publishes no availability at all, and the symptom
 * — "the booking page is empty" — points at everything except the timetable. So an empty
 * week gets a warning rather than a shrug.
 *
 * ------------------------------------------------------------------------------
 * ONE FORM FOR THE WHOLE WEEK, BECAUSE THE ENDPOINT IS A PUT ON A COLLECTION.
 *
 * The body IS the timetable: a day the body does not name is DELETED. Seven per-day forms
 * would each send one day and wipe the other six, so there is exactly one submit button
 * here and `model/week.ts` builds all seven rows every time. That is not a convenience —
 * it is the shape the endpoint requires, and getting it wrong deletes a clinic's opening
 * hours on the first save.
 *
 * ------------------------------------------------------------------------------
 * CLOSED IS A CHECKBOX, NOT AN EMPTY PAIR OF BOXES.
 *
 * An unticked checkbox is ABSENT from a form post rather than false, which is exactly the
 * fact `checked()` in screen.ts exists to state once. A day marked closed is sent with no
 * times at all: the columns behind them are NOT NULL and the controller writes
 * midnight-to-midnight, so sending whatever the administrator happened to leave in the
 * boxes would be recording a decision they did not make.
 *
 * There is no overnight day. `UpdateWorkingHoursRequest` refuses a closing time at or
 * before the opening time and says to mark the day closed instead — a clinic open
 * 22:00–02:00 needs a second row and a range type, and inventing that from an ambiguous
 * pair would publish availability nobody staffs.
 */

export type WorkingHoursScreenProps = {
  paths: TenantPaths
  saved?: string | undefined
  problem?: string | undefined
}

export async function WorkingHoursScreen({ paths, saved, problem }: WorkingHoursScreenProps) {
  const result = await attempt(listWorkingHours())

  if (!result.ok) {
    return <AccessNotice failure={result} context="this clinic's opening hours" />
  }

  const hours = result.value
  const stored = byDay(hours)
  const anyOpenDay = opensAtAll(hours)

  return (
    <div className="grid">
      {problem === undefined ? null : (
        <Notice tone="bad" title="That was not saved" announce>
          {problem}
        </Notice>
      )}

      {saved === undefined ? null : <Notice tone="info">{saved}</Notice>}

      {anyOpenDay ? null : (
        <Notice tone="warn" title="No patient can book anything yet" icon="clock">
          Appointment times are generated from these hours. While every day is marked closed
          the clinic publishes no times at all, so the booking page will be empty however
          many services and clinicians are set up.
        </Notice>
      )}

      <Card as="section">
        <span className="eyebrow">Opening hours</span>
        <h2 className="title-sm">The week, as patients will be offered it</h2>
        <p className="muted">
          All times are Africa/Kampala. Saving replaces the whole week at once — a day you
          mark closed stops being offered immediately.
        </p>

        <form
          action={saveWeek.bind(null, { selfPath: paths.hours })}
          style={{ marginTop: 'var(--space-6)' }}
        >
          <div className="table-scroll">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Opens</th>
                  <th scope="col">Closes</th>
                  <th scope="col">Closed all day</th>
                </tr>
              </thead>
              <tbody>
                {WEEK.map((day) => {
                  const row = stored.get(day.value)
                  const closed = row === undefined || row.is_closed

                  return (
                    <tr key={day.value}>
                      <th scope="row" style={{ fontWeight: 600 }}>
                        {day.label}
                      </th>
                      <td>
                        {/* A label for every control, even in a table. A column header is
                            not a label: a screen reader reading the row announces "Opens",
                            and then a second unlabelled control on the next row. */}
                        <label className="sr-only" htmlFor={`opens-${day.value}`}>
                          {day.label} opening time
                        </label>
                        <input
                          className="input"
                          type="time"
                          id={`opens-${day.value}`}
                          name={`opens-${day.value}`}
                          defaultValue={closed ? '' : toTimeInput(row?.opens_at)}
                        />
                      </td>
                      <td>
                        <label className="sr-only" htmlFor={`closes-${day.value}`}>
                          {day.label} closing time
                        </label>
                        <input
                          className="input"
                          type="time"
                          id={`closes-${day.value}`}
                          name={`closes-${day.value}`}
                          defaultValue={closed ? '' : toTimeInput(row?.closes_at)}
                        />
                      </td>
                      <td>
                        <label className="row" htmlFor={`closed-${day.value}`}>
                          <input
                            className="choice__input"
                            type="checkbox"
                            id={`closed-${day.value}`}
                            name={`closed-${day.value}`}
                            defaultChecked={closed}
                          />
                          <span className="sr-only">{day.label} closed all day</span>
                        </label>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="row-wrap" style={{ marginTop: 'var(--space-6)' }}>
            <Button type="submit" variant="primary">
              Save the week
            </Button>
            <span className="fine">
              A clinic that stops opening on Saturdays says so by marking Saturday closed.
            </span>
          </div>
        </form>
      </Card>

      <Card as="section">
        <span className="eyebrow">Not here</span>
        <h2 className="title-sm">Public holidays and one-off closures</h2>
        <p className="muted">
          Carevelo has no holiday calendar yet, so a clinic closing for a public holiday has
          to mark the day closed and put it back afterwards. That is a real gap rather than
          a hidden feature, and it is worth knowing before somebody books an appointment for
          Independence Day.
        </p>
      </Card>
    </div>
  )
}

type WeekContext = { selfPath: string }

/**
 * Replace the whole week.
 *
 * The times are NOT validated here beyond what the browser's `type="time"` already
 * enforces. `UpdateWorkingHoursRequest` checks the format, refuses a closing time at or
 * before the opening time, and refuses a duplicate day — and it writes a sentence for each.
 * Re-checking any of that here would be a second copy of a rule that is allowed to move,
 * and the copy would be the one nobody updates.
 */
async function saveWeek(context: WeekContext, formData: FormData): Promise<void> {
  'use server'

  const back = samePath(context.selfPath, '/')
  const week = weekFromForm((name) => text(formData, name))

  let failure: string | null = null

  try {
    await replaceWorkingHours(week)
  } catch (error) {
    failure = writeFailure(error, 'saving the opening hours')
  }

  if (failure !== null) {
    redirect(withParams(back, { problem: failure, saved: null }))
  }

  redirect(
    withParams(back, {
      saved: 'Opening hours saved. Appointment times follow from these immediately.',
      problem: null,
    }),
  )
}
