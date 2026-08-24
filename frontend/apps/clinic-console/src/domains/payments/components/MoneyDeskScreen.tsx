import { redirect } from 'next/navigation'
import { Button, Card, Field, Grid, Input, Notice, PageHeader, Stack } from '@carevelo/ui'
import { NonCustodialNotice } from './NonCustodialNotice'
import { RevenuePlaceholder } from './RevenuePlaceholder'

/**
 * The landing screen for money, messages and the audit trail.
 *
 * ------------------------------------------------------------------
 * WHY THERE IS NO LIST OF PAYMENTS ON IT
 *
 * Because there is no endpoint for one, and its absence is a design decision rather than an
 * oversight. `GET /v1/payment-intents` does not exist: a payment attempt is reached by its
 * id, from the appointment or dispense order it was raised against, or from the
 * reconciliation view — which is the clinic administrator's screen alone. The effect is
 * that a front-desk clerk cannot browse the clinic's payments, by construction, which is a
 * sensible thing not to be able to do.
 *
 * A "recent payments" table faked from the reconciliation endpoint would defeat that, since
 * that endpoint is administrator-only and would simply 403 for the people this screen is
 * mostly for. So the desk offers the one thing it honestly can: a way to open a specific
 * record when you are holding its identifier.
 *
 * ------------------------------------------------------------------
 * WHY THE LOOKUP TAKES AN ID AND NOT A PAYMENT REFERENCE
 *
 * Because `GET /v1/payment-intents/{id}` is keyed on the id, and there is no lookup by
 * reference anywhere in the API. Offering a box that accepts the human-facing reference —
 * the string on the patient's SMS, and the obvious thing to type — would fail every time
 * with a 404 that looks like the payment does not exist. The box says what it takes, and
 * the sentence beside it says where staff normally get one instead of typing it at all.
 */

export function MoneyDeskScreen({
  /** This screen's own path, so a refused lookup can come back to it. */
  selfPath,
  /** `?problem=…` from a refused lookup. A closed set; see below. */
  problem,
}: {
  selfPath: string
  problem?: string | undefined
}) {
  return (
    <div className="grid">
      <PageHeader
        title="Money desk"
        description={
          <>
            Cash taken at the counter, the day&rsquo;s records, what the clinic sent to
            patients, and who did what.
          </>
        }
      />

      <NonCustodialNotice />

      <Card as="section">
        {/* One column for the card. The `marginBlock` on the notice was already saying the
            same 12px above and below that this gap says once, and it had to be written as
            `marginBlock` precisely because a margin cannot know what follows it. */}
        <Stack gap="4">
          <Stack gap="2">
            <h2 className="title">Open a payment record</h2>
            <p className="muted">
              Staff usually arrive here from the appointment or the dispense order the payment
              was raised against, or from a line in reconciliation. If you are holding a payment
              record identifier, paste it here.
            </p>
          </Stack>

          {problem === 'malformed' ? (
            <Notice tone="warn" title="That does not look like a payment record identifier" announce>
              <p>
                It should be 26 letters and digits with no spaces. The shorter reference on a
                patient&rsquo;s message is not the same thing and cannot be looked up here.
              </p>
            </Notice>
          ) : null}

          {/* `<Field>` rather than a `<label>` and an `<input>` typed out beside each other:
              Field owns the `htmlFor`/`id` pair, which is the wiring that silently rots the
              first time a field is copied to another screen and renamed on one side only. */}
          <form action={openRecord.bind(null, selfPath)} className="row-wrap">
            <Field name="id" id="record-id" label="Payment record identifier" className="grow">
              {(control) => (
                <Input
                  {...control}
                  className="mono"
                  required
                  autoComplete="off"
                  spellCheck={false}
                  inputMode="text"
                />
              )}
            </Field>
            <Button type="submit" variant="primary">
              Open
            </Button>
          </form>
        </Stack>
      </Card>

      <RevenuePlaceholder />

      <Grid cols={3}>
        <Card>
          <h3 className="title-sm">
            <a href="/payments/reconciliation">Reconciliation</a>
          </h3>
          <p className="muted">
            One day of payment records with the aggregator&rsquo;s reference on each, the ones
            that need a look flagged, and a CSV for your books. Clinic administrator only.
          </p>
        </Card>
        <Card>
          <h3 className="title-sm">
            <a href="/payments/messages">Messages</a>
          </h3>
          <p className="muted">
            Every message this clinic sent, whether it arrived, and how many went out this
            month. Answers &ldquo;was the patient told?&rdquo;
          </p>
        </Card>
        <Card>
          <h3 className="title-sm">
            <a href="/payments/audit">Audit log</a>
          </h3>
          <p className="muted">
            Who did what, when, to which record. Read-only for everyone, including Carevelo.
          </p>
        </Card>
      </Grid>
    </div>
  )
}

/**
 * Send the person to the record they asked for.
 *
 * THE SHAPE IS CHECKED BEFORE IT BECOMES A PATH. The value comes from a text box, so it is
 * input from the far side of the wire, and it is about to be interpolated into a URL this
 * app then navigates to. Restricting it to the character set of a ULID means a pasted
 * `../../something`, a query string or a scheme cannot survive the check — `encodeURIComponent`
 * would also neutralise them, but a value that is not an identifier should be refused with a
 * sentence rather than sent to the API to produce a 404 nobody can interpret.
 *
 * The check is on SHAPE and never on existence. Whether the record is there, and whether
 * this clinic may see it, is the API's answer, and it answers 404 to both — deliberately, so
 * that nobody can discover which clinic holds which record by trying identifiers.
 */
async function openRecord(selfPath: string, formData: FormData): Promise<void> {
  'use server'

  const id = String(formData.get('id') ?? '').trim()
  const back = selfPath.startsWith('/') && !selfPath.startsWith('//') ? selfPath : '/payments'

  // A ULID: 26 characters of Crockford base32, case-insensitive.
  if (!/^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/.test(id)) {
    redirect(`${back}?problem=malformed`)
  }

  redirect(`/payments/records/${encodeURIComponent(id)}`)
}
