import type { ReactElement } from 'react'
import { Card, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * The consultation room, held in place while it is opened.
 *
 * IT EXISTS SEPARATELY FROM `schedule/loading.tsx` BECAUSE A DAY AND A ROOM ARE NOT THE
 * SAME SHAPE. The schedule's fallback reserves a column of appointment rows; this screen is
 * a page head, one panel and a note. A clinician clicking through from the day would
 * otherwise watch a list of rows resolve into a single form.
 *
 * `title="Consultation"` and `active="schedule"` are what the page passes, and the tab must
 * not move during the wait: a consultation is opened from the schedule and belongs to it.
 *
 * See patients/loading.tsx for why `ConsoleShell` is rendered here rather than skeletoned.
 *
 * ------------------------------------------------------------------------------------
 * NO HEADING, AND THIS IS THE ROUTE WHERE THAT MATTERS MOST IN THE WHOLE CONSOLE.
 *
 * `ConsultationRoom`'s <h1> is A PATIENT'S NAME, with the appointment time and reference
 * under it. `loading.tsx` is passed no props, so this file cannot know whose room is
 * opening — and putting a plausible bar where a name goes, on the screen where a clinician
 * is about to write a clinical note, is the single worst thing any fallback in this product
 * could do. A note written into the wrong record is not a rendering defect.
 *
 * The line is reserved and left empty until the name is true. The shell still says
 * "Consultation" in the topbar, so the screen is not anonymous while it waits — it is only
 * the PATIENT that is unknown, which is exactly the case.
 *
 * NOTHING BELOW IS CLINICAL EITHER. This screen resolves into one of three quite different
 * things — a door to knock on, an open room with a note form in it, or a read-only record
 * of a consultation that has ended — and the placeholder deliberately draws none of them
 * specifically. A skeleton that outlined "diagnosis" and "medicines" would put the shape of
 * a clinical record on screen before there is a record, in a room that may not even open.
 * ------------------------------------------------------------------------------------
 */
export default function ConsultationRoomLoading(): ReactElement {
  return (
    <ConsoleShell title="Consultation" active="schedule">
      <Stack gap="6">
        {/* The page head: the patient's name, the appointment time and reference beneath
            it, and the mode and outcome badges beside them. */}
        <Stack gap="3">
          <Skeleton lines={1} className="title-lg" />
          <Skeleton lines={1} />
        </Stack>

        {/*
         * One panel, sized for the middle of the three outcomes rather than the largest.
         * The door is a heading and a button; the open room is a note form; the ended
         * consultation is the record of one. `block="lg"` reserves the room a form needs so
         * that the commonest case fills rather than grows — and where the door arrives
         * instead, the page settles upward into the space, which is the direction that does
         * not move a control out from under somebody's cursor.
         */}
        <Card as="section">
          <Stack gap="4">
            <Skeleton lines={1} className="title-sm" />
            <Skeleton block="lg" />
          </Stack>
        </Card>

        {/* The standing note under the room — what entering it records, and who else can
            see that it happened. */}
        <Skeleton block="sm" />
      </Stack>
    </ConsoleShell>
  )
}
