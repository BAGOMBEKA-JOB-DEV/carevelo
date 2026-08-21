import { redirect } from 'next/navigation'
import { Button, Card, Choice, Icon, Notice } from '@carevelo/ui'
import { setStatus } from '../api/deliveries'
import { deliveryHref, href } from '../model/links'
import { FAILURE_REASONS, isKnownStatus, view } from '../model/status'
import type { DeliveryPaths, DeliveryStatus, RiderDelivery, StatusProblem } from '../model/types'
import { CallRecipient } from './CallRecipient'
import { DeliveryStatusBadge } from './DeliveryStatusBadge'

/**
 * ONE DELIVERY: who it is for, where it goes, and the one control that moves it.
 *
 * ==================================================================
 * WHAT IS ON THIS SCREEN, AND WHAT CAN NEVER BE.
 * ==================================================================
 *
 * Recipient name. Recipient phone. Delivery address. Package reference. Four fields,
 * because those are the four a rider receives — and the reason nothing else appears is
 * not that this component declines to render it: `RiderDeliveryResource` has no other
 * property on it, so there is nothing to render. A diagnosis, a clinical note, a
 * prescription or a medicine list are absent from the type, absent from the response and
 * absent from this app's dependency graph, which carries no prescriptions, consultations,
 * dispensing or patients domain at all.
 *
 * That is the frontend half of the rule the backend states as: "A hidden field is one
 * careless template away from being displayed; an absent field cannot be."
 *
 * @see docs/50-security-compliance/data-protection-dppa.md — "The rider rule"
 *
 * ==================================================================
 * ONE STATUS CONTROL, NOT FOUR VERBS.
 * ==================================================================
 *
 * There is a single endpoint carrying the TARGET status, and this screen offers a single
 * move at a time: the one the state machine allows from where the delivery actually is.
 * Which move that is comes from `model/status.ts`, keyed on the generated status union, so
 * a rider is never shown a button the server will refuse and never left on a delivery
 * with no way forward.
 *
 * "Could not deliver" appears ONLY while the delivery is `en_route`, because that is the
 * only state `failed` is reachable from. A package still on the pharmacy counter has not
 * failed; it has not started.
 *
 * ==================================================================
 * NO JAVASCRIPT IS REQUIRED TO USE THIS SCREEN.
 * ==================================================================
 *
 * Plain form posts and plain links, all the way down — including the failure flow, which
 * opens through a `?report=1` link rather than by toggling something in the browser. A
 * rider at the roadside on a stalled connection can still record a delivery from HTML the
 * server already sent, and every action ends in a redirect so that pulling the page down
 * to refresh can never re-post anything.
 */

export type DeliveryScreenProps = {
  delivery: RiderDelivery
  paths: DeliveryPaths
  /** `?report=1` — the rider has asked for the "could not deliver" reasons. */
  reporting?: boolean | undefined
  /** `?done=<status>` — a move that has just been recorded from this screen. */
  done?: string | undefined
  /** `?already=1` — the move had already landed; the tap was a repeat. */
  already?: boolean | undefined
  /** `?problem=` — see `StatusProblem`. */
  problem?: string | undefined
  /** `?message=` — the API's own sentence about that failure. */
  message?: string | undefined
}

export function DeliveryScreen({
  delivery,
  paths,
  reporting = false,
  done,
  already = false,
  problem,
  message,
}: DeliveryScreenProps) {
  const state = view(delivery.status)
  const self = deliveryHref(paths, delivery.id)

  /**
   * Where the rider goes after a move lands.
   *
   * A COMPLETED DELIVERY GOES BACK TO THE LIST, because it has left the list — the rider
   * endpoint serves only `assigned`, `picked_up` and `en_route`, so staying here would
   * leave them looking at a screen with no next action and a status that will never
   * change again. An intermediate move stays put, because the address and the telephone
   * number are still the two things they need.
   */
  const after = (target: DeliveryStatus, repeat: boolean): string => {
    const flags = { ...(repeat ? { already: '1' } : {}) }

    if (target === 'delivered' || target === 'failed') {
      return href(paths.assignments, { done: target, ...flags })
    }

    return deliveryHref(paths, delivery.id, { done: target, ...flags })
  }

  /** Where the rider goes when a move does not land. */
  const onProblem = (kind: StatusProblem, detail: string | null): string => {
    /*
     * A REFUSAL GOES BACK TO THE LIST, and this is the one case that must not stay here.
     * 403 and 404 collapse to the same answer on purpose — the delivery is not this
     * rider's, and whether it belongs to a colleague or to another clinic entirely is
     * exactly the difference we decline to disclose. Sending them to a list that is true
     * says everything a rider needs and nothing more.
     */
    if (kind === 'refused') {
      return href(paths.assignments, { problem: kind })
    }

    return deliveryHref(paths, delivery.id, {
      problem: kind,
      ...(detail ? { message: detail } : {}),
      // A rejected reason reopens the chooser rather than dropping the rider back to a
      // screen with no obvious way to try again.
      ...(kind === 'invalid' ? { report: '1' } : {}),
    })
  }

  /**
   * Advance to the next status.
   *
   * THE TARGET IS CLOSED OVER, NOT POSTED. It is whatever the server decided when it
   * rendered this screen, so a form body cannot ask for a transition the rider was not
   * offered. Nothing that arrives from the browser influences this action at all — which
   * is what makes it safe for the action to redirect, since its destination likewise
   * comes from `paths` and never from the request.
   */
  async function advance() {
    'use server'

    if (state.advance === null) {
      return redirect(self)
    }

    const target = state.advance.target
    const outcome = await setStatus(delivery.id, target)

    if (outcome.kind === 'changed') {
      return redirect(after(target, false))
    }

    if (outcome.kind === 'already') {
      // Not an error, and never shown as one. The tap landed the first time and the
      // answer was lost coming back — see `setStatus()` for the whole reasoning.
      return redirect(after(target, true))
    }

    return redirect(onProblem(outcome.problem, outcome.message))
  }

  /**
   * Record that the delivery could not be completed.
   *
   * THE REASON IS THE ONE THING THIS DOMAIN TAKES FROM THE BROWSER, and it is checked
   * against the fixed list before it is sent — see `setStatus()`. Free text is not offered
   * anywhere on this screen: the backend refuses it, a clinic that cannot count its wrong
   * addresses cannot fix them, and a text box at somebody's gate is precisely where a
   * medicine name or a remark about the recipient's health would be typed into a field
   * that is carried on a broadcast frame.
   */
  async function reportFailure(formData: FormData) {
    'use server'

    const reason = String(formData.get('failure_reason') ?? '')
    const outcome = await setStatus(delivery.id, 'failed', reason)

    if (outcome.kind === 'changed') {
      return redirect(after('failed', false))
    }

    if (outcome.kind === 'already') {
      return redirect(after('failed', true))
    }

    return redirect(onProblem(outcome.problem, outcome.message))
  }

  return (
    <>
      <div className="page-head">
        <div className="grow stack">
          <span className="eyebrow tnum">{delivery.reference}</span>
          <h1>{delivery.recipient_name}</h1>
        </div>
        <DeliveryStatusBadge status={delivery.status} />
      </div>

      <div className="stack" style={{ gap: 'var(--space-5)' }}>
        {/* `isKnownStatus` because `done` came off the query string — see model/status.ts.
            A banner that says "Recorded: status unknown" is worse than no banner. */}
        {done && isKnownStatus(done) ? (
          <Notice tone="info" icon="check" title={`Recorded: ${view(done).label.toLowerCase()}`}>
            {already
              ? 'This was already recorded — your first tap went through. Nothing was '
                + 'recorded twice.'
              : 'The clinic can see this.'}
          </Notice>
        ) : null}

        {problem === 'conflict' ? (
          <Notice tone="warn" title="This delivery has already changed">
            {message ?? 'Somebody else moved it. What you see below is where it is now.'}
          </Notice>
        ) : null}

        {problem === 'failed' ? (
          <Notice tone="bad" title="That did not go through">
            {message ??
              'Nothing was recorded. Check you have signal and try again — the status '
                + 'below is what the clinic currently has.'}
          </Notice>
        ) : null}

        {problem === 'invalid' ? (
          <Notice tone="warn" title="Choose a reason">
            {message ?? 'A delivery that could not be completed needs one of the reasons below.'}
          </Notice>
        ) : null}

        {/* ---- Where it goes ---- */}
        <Card className="stack">
          <h2 className="eyebrow">Deliver to</h2>
          {/* The address is the largest text on the screen after the name, because it is
              read at a junction with a helmet on. */}
          <p>{delivery.address_text}</p>

          {/*
            THE LANDMARK IS NOT DECORATION. Ugandan addresses are frequently a landmark and
            a district rather than a street number — "Opposite Shell Bugolobi" is how riders
            actually navigate, which is why the backend collects it as its own field. It is
            given its own line rather than being run into the address, so it is findable at
            a glance.
          */}
          {delivery.landmark ? (
            <p className="row">
              <Icon name="pin" className="ico" />
              <span>{delivery.landmark}</span>
            </p>
          ) : null}

          {delivery.district ? <p className="muted">{delivery.district}</p> : null}
        </Card>

        {/* ---- Who to hand it to ---- */}
        <Card className="stack">
          <h2 className="eyebrow">Recipient</h2>
          <p>{delivery.recipient_name}</p>
          <CallRecipient
            name={delivery.recipient_name}
            phone={delivery.recipient_phone}
            size="lg"
            block
          />
        </Card>

        {/* ---- The one control ---- */}
        {state.advance ? (
          <form action={advance} className="stack">
            <Button type="submit" variant="primary" size="lg" block>
              {state.advance.action}
            </Button>
            <p className="muted" style={{ textAlign: 'center' }}>
              {state.advance.consequence}
            </p>
          </form>
        ) : (
          <Notice tone="neutral" icon="check" title={state.label}>
            There is nothing more to do here. This delivery is no longer on your round.
          </Notice>
        )}

        {/* ---- Could not deliver ---- */}
        {state.mayFail && !reporting ? (
          /*
            A LINK, NOT A BUTTON, AND NOT NEXT TO THE PRIMARY ONE. This is the control a
            rider must never press by accident with a thumb aimed at "Delivered" — the two
            record opposite outcomes and only one of them can be undone, by a dispatcher,
            over the telephone. Quiet, below, and it opens a second screen state rather
            than firing.
          */
          <p style={{ textAlign: 'center' }}>
            <a className="lnk" href={deliveryHref(paths, delivery.id, { report: '1' })}>
              I could not deliver this
            </a>
          </p>
        ) : null}

        {state.mayFail && reporting ? (
          <Card className="stack">
            <form action={reportFailure} className="stack" style={{ gap: 'var(--space-5)' }}>
              <Choice
                name="failure_reason"
                legend="Why could you not deliver it?"
                hint="The clinic uses these to fix addresses and to decide what happens next."
                options={FAILURE_REASONS.map((reason) => ({
                  value: reason.value,
                  label: reason.label,
                  note: reason.note,
                }))}
                required
              />

              <Notice tone="warn" icon="box">
                Take the package back to the pharmacy today. Medicine belongs on licensed
                premises and never stays with a rider overnight.
              </Notice>

              <Button type="submit" variant="danger" size="lg" block>
                Record: not delivered
              </Button>

              <p style={{ textAlign: 'center' }}>
                <a className="lnk" href={self}>
                  Go back
                </a>
              </p>
            </form>
          </Card>
        ) : null}

        <p style={{ textAlign: 'center' }}>
          <a className="lnk" href={paths.assignments}>
            ← All my deliveries
          </a>
        </p>
      </div>
    </>
  )
}
