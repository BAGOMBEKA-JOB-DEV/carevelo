import type { ReactElement } from 'react'
import { Card, PageHeader, Skeleton, Stack } from '@carevelo/ui'
import { ConsoleShell } from '@/components/ConsoleShell'

/**
 * The consent desk, in the shape it will arrive in.
 *
 * IT IS THE SLOWEST SCREEN IN THE PATIENTS SECTION, WHICH IS WHY IT EARNS ITS OWN FALLBACK
 * RATHER THAN INHERITING THE RECORD'S. The page reads the patient, and the screen then reads
 * the current consent policy in the language asked for AND the existing consent history — so
 * a member of staff who switches the policy language with a patient sitting in front of them
 * waits on a fresh round trip every time. Without this file that wait happens on the record
 * screen's two-by-two grid of cards, which is not this screen's shape at all.
 *
 * See patients/loading.tsx for why `ConsoleShell` is rendered here for real and costs
 * nothing, and why `active="patients"` has to be stated.
 *
 * THE HEADING IS REAL AND THE NAME BESIDE IT IS NOT. "Consent" is fixed; the description is
 * the patient's own name, read from the record still being fetched, and a fallback is passed
 * no route parameter with which to know it. On this screen more than any other in the
 * section that matters: a consent decision is a legal record of what one named person
 * agreed to, and a name that turns out to be somebody else's — even for a quarter of a
 * second, even while a member of staff is reading the policy aloud — is the wrong direction
 * to be wrong in.
 *
 * ------------------------------------------------------------------------------------
 * NOT ONE OF THE DECISIONS IS SKETCHED.
 *
 * The real screen puts three separate consent decisions in front of the desk, each with a
 * heading, an explanation and its own pair of controls, and around them sit notices whose
 * presence is itself information — that this patient is under 18, that a registration ended
 * when consent was declined, that the history could not be read. Drawing labelled panels
 * with control-sized bars in them would outline how many choices there are and roughly how
 * long each one is, before a word of any of them is true. The shape of a decision is part of
 * the decision.
 *
 * So: the policy is reserved as one tall panel, because a panel of prose is what it is, and
 * everything below it is reserved as height and nothing else. Nothing here is tinted, because
 * a tint on this screen is how a warning is told apart from a note.
 * ------------------------------------------------------------------------------------
 */
export default function ConsentDeskLoading(): ReactElement {
  return (
    <ConsoleShell title="Consent" active="patients">
      <Stack gap="6">
        <PageHeader title="Consent" />

        {/* The standing note that the desk is recording the patient's decision and not
            making it. On the screen every time, so reserved every time. */}
        <Skeleton block="sm" />

        {/* "What the patient is agreeing to" — the policy text, in the language asked for.
            `block="lg"` because it is the tallest thing on the screen by a distance and the
            part that arrives last; under-reserving it would walk every control below it up
            the page at the moment somebody is reaching for one. */}
        <Card as="section">
          <Stack gap="4">
            <Skeleton lines={1} className="title-sm" />
            <Skeleton block="lg" />
          </Stack>
        </Card>

        {/* The decisions, and the control that records them. Height only. */}
        <Skeleton block="lg" />

        {/* What has been agreed to before, which is read separately and may fail on its
            own. */}
        <Card as="section">
          <Stack gap="4">
            <Skeleton lines={1} className="title-sm" />
            <Skeleton block="md" />
          </Stack>
        </Card>
      </Stack>
    </ConsoleShell>
  )
}
