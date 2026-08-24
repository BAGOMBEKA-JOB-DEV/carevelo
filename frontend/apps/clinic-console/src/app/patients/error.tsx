'use client'

import type { ReactElement } from 'react'
import { Button } from '@carevelo/ui'
import { ConsoleErrorScreen } from '../error'

/**
 * A patients screen that could not be built.
 *
 * WHY THIS SECTION GETS ITS OWN BOUNDARY. The generic console screen tells a member of staff
 * that nothing they were looking at has changed and offers the schedule. On this section the
 * useful sentence is a different one, and it is about what they are about to do next rather
 * than about what just failed: a front desk that cannot open a patient's record, with the
 * patient standing in front of them, registers the patient again. That is how a duplicate is
 * created — and a duplicate has to be merged back by hand on a screen whose own copy says
 * there is no way back from a merge. Until somebody performs one, that patient's care is
 * split across two records: a consent decision on one, a prescription on the other.
 *
 * SO THE COPY NAMES THE SEARCH RATHER THAN THE FORM. Searching the registry by telephone
 * number is the correct next action for every route under this section — the record, the
 * details, the consent desk, the portal account, the merge screen — because in all five cases
 * the thing that failed was a READ of a record that already exists.
 *
 * IT ALSO SAYS WHAT DID NOT HAPPEN, because three of the routes under here end in writes: a
 * registration, a correction, a consent decision. `reset()` re-renders the segment, and
 * re-rendering the page a Server Action was invoked from does not replay the action, so the
 * retry itself is safe — but a member of staff who cannot tell whether the consent they just
 * recorded went through will record it again, and a consent decision entered twice is two
 * entries in the audit trail against one patient's name.
 *
 * NOTHING ABOUT THE PATIENT APPEARS HERE, and there is nothing in this component that could
 * render one. `error.message` on these routes carries a patient identifier in a request URL
 * and frequently a name; it is never rendered and never logged from here. See the parent
 * boundary for the whole rule and for why `error.digest` is the one exception to it.
 */
export default function PatientsError({
  error,
  reset,
}: {
  error: Error & { digest?: string | undefined }
  reset: () => void
}): ReactElement {
  return (
    <ConsoleErrorScreen
      title="This patient screen did not load"
      error={error}
      reset={reset}
      actions={
        <>
          <Button variant="quiet" size="lg" href="/patients">
            Search the registry
          </Button>
          <Button variant="ghost" size="lg" href="/schedule">
            Go to the schedule
          </Button>
        </>
      }
    >
      This page failed before it could read anything, so nothing on it tells you whether this
      patient has a record, what is on it, or whether anything you just saved was saved. Do
      not register them again — search the registry for their telephone number first. A second
      record has to be merged back by hand, and a merge cannot be undone.
    </ConsoleErrorScreen>
  )
}
