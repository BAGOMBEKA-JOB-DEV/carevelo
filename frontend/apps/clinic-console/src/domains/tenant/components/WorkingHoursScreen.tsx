import { redirect } from 'next/navigation'
import { Button, Card, DataTable, Inline, Notice, Stack } from '@carevelo/ui'
import { attempt, writeFailure } from '../api/http'
import { listWorkingHours, replaceWorkingHours } from '../api/workingHours'
import { WEEK, byDay, opensAtAll, toTimeInput, weekFromForm } from '../model/week'
import type { TenantPaths } from '../model/types'
import { AccessNotice } from './AccessNotice'
import { first, samePath, text, withParams, type SearchValue } from './screen'

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
  saved?: SearchValue
  problem?: SearchValue
}

export async function WorkingHoursScreen(props: WorkingHoursScreenProps) {
  const { paths } = props
  const saved = first(props.saved)
  const problem = first(props.problem)

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
        {/* One column for the card: the heading block was flush in normal flow and the form
            was pushed down by a hand-set margin, so `gap="none"` keeps the first exactly as
            it was and the outer gap IS the second. */}
        <Stack gap="6">
          <Stack gap="none">
            <span className="eyebrow">Opening hours</span>
            <h2 className="title-sm">The week, as patients will be offered it</h2>
            <p className="muted">
              All times are Africa/Kampala. Saving replaces the whole week at once — a day you
              mark closed stops being offered immediately.
            </p>
          </Stack>

          <form action={saveWeek.bind(null, { selfPath: paths.hours })}>
            <Stack gap="6">
              {/*
                `<DataTable>` rather than the hand-written table this was. The markup here was
                already good — a real `<table>`, `scope` on every header, a `.table-scroll`
                wrapper — and the two things it was missing are the two this component makes
                impossible to leave out. It had no `<caption>`, so a screen-reader user
                landing in it was given seven rows of time inputs with nothing saying what
                week they belong to; and the scroll wrapper was not focusable, so on a narrow
                screen the columns that overflow could not be reached by anyone without a
                mouse. The caption is hidden because the `<h2>` directly above says the same
                words to a sighted reader.

                Each cell still builds its own row lookup: `stored` is a Map and a day with no
                stored row is CLOSED, which is the same reading `closed` had before.
              */}
              <DataTable
                caption="The clinic's opening time and closing time for each day of the week"
                captionHidden
                rows={WEEK}
                rowKey={(day) => String(day.value)}
                /* Unreachable: WEEK is a seven-element module constant, not a fetched list.
                   `empty` is required by construction and there is no honest EmptyState for
                   "the week has no days", so it says the only true thing. */
                empty={<p className="muted">The week could not be built.</p>}
                columns={[
                  {
                    key: 'day',
                    header: 'Day',
                    /* `.table tbody th` in console.css already sets the weight a row's name
                       wants; it used to be stated inline on every one of these. */
                    rowHeader: true,
                    cell: (day) => day.label,
                  },
                  {
                    key: 'opens',
                    header: 'Opens',
                    cell: (day) => {
                      const row = stored.get(day.value)
                      const closed = row === undefined || row.is_closed

                      return (
                        <>
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
                        </>
                      )
                    },
                  },
                  {
                    key: 'closes',
                    header: 'Closes',
                    cell: (day) => {
                      const row = stored.get(day.value)
                      const closed = row === undefined || row.is_closed

                      return (
                        <>
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
                        </>
                      )
                    },
                  },
                  {
                    key: 'closed',
                    header: 'Closed all day',
                    cell: (day) => {
                      const row = stored.get(day.value)
                      const closed = row === undefined || row.is_closed

                      return (
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
                      )
                    },
                  },
                ]}
              />

              <Inline gap="4">
                <Button type="submit" variant="primary">
                  Save the week
                </Button>
                <span className="fine">
                  A clinic that stops opening on Saturdays says so by marking Saturday closed.
                </span>
              </Inline>
            </Stack>
          </form>
        </Stack>
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
