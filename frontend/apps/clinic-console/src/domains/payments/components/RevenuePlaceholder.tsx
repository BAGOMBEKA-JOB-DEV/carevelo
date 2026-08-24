import { Badge, Card, Inline, Stack } from '@carevelo/ui'

/**
 * The revenue screen, which does not exist, said out loud.
 *
 * ------------------------------------------------------------------
 * WHY THERE IS NO CHART HERE
 *
 * "What did we take this month?" is named as the retention-critical question in three
 * product documents, and it is genuinely the thing a clinic owner opens a console for. It
 * is also the one number this platform currently cannot produce.
 *
 * There is no revenue endpoint. The only figures available are the ones
 * `GET /v1/reconciliation` returns for a single day, and those are counts of ATTEMPTS the
 * platform recorded — not observations of money that arrived. Summing them into "revenue"
 * would mean asserting that every attempt the aggregator reported as succeeded actually
 * reached the clinic's account, which is exactly the claim this architecture is built to
 * never make: the funds never pass through Carevelo and nobody here can see the clinic's
 * account.
 *
 * So a chart drawn from that data would be a plausible, precise, confidently-rendered
 * number that nobody could stand behind — and a clinic owner would make decisions on it.
 * The gap between "we have not built this" and "we built something that quietly guesses" is
 * the whole difference, and a placeholder is on the correct side of it.
 *
 * WHY A PLACEHOLDER AT ALL, RATHER THAN NOTHING. The question does not go away when the
 * screen is missing; it turns into a support call, or worse into somebody exporting the CSV
 * and adding up a column whose header deliberately says `requested_amount_minor`. Naming
 * the screen, saying what it will show and saying what it is waiting for is the honest
 * version of the same information.
 *
 * @see docs/10-product/prd-h5-payments-non-custodial.md
 */
export function RevenuePlaceholder() {
  return (
    <Card as="section">
      {/* Four `marginTop`s, all of them the same step, all of them saying the space BELOW
          the element above. One column, one gap, and a paragraph added later cannot arrive
          without it. */}
      <Stack gap="4">
        <Inline justify="between">
          <h2 className="title">What this clinic took</h2>
          <Badge tone="warn">Waiting on the API</Badge>
        </Inline>

        <p className="muted">
          This is where a month of takings will go: what was collected, by service and by way
          of paying, and how it compares with the month before.
        </p>

        <p className="muted">
          It is not here yet because there is no endpoint that can answer it honestly. The only
          figures the platform holds are counts of the payment attempts it recorded, one day at
          a time, and money never passes through Carevelo — so adding those up would produce a
          confident number about your account that we have no way to check. You would make
          decisions on it, and it might be wrong.
        </p>

        <p className="muted">
          Until then, <a className="lnk" href="/payments/reconciliation">reconciliation</a> shows
          every record we hold for a day with the aggregator&rsquo;s reference against each one,
          and exports the same records as a CSV for your own books.
        </p>
      </Stack>
    </Card>
  )
}
