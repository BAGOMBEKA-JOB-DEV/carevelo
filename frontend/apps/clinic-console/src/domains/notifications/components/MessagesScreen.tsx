import { Notice, PageHeader } from '@carevelo/ui'
import type { Attempt } from '../api/http'
import type { TemplateCatalogue as Catalogue } from '../api/notifications'
import type { NotificationFilters, NotificationPage, SmsUsage } from '../api/types'
import { SendHistory } from './SendHistory'
import { SmsUsagePanel } from './SmsUsagePanel'
import { TemplateCatalogue } from './TemplateCatalogue'

/**
 * Everything the clinic told its patients, and everything it could tell them.
 *
 * ------------------------------------------------------------------
 * THREE READS, THREE INDEPENDENT FAILURES
 *
 * The screen takes three `Attempt`s rather than three resolved values, and each panel
 * renders its own failure. That is deliberate: the send history is the panel somebody came
 * here for, and losing it because the template catalogue call failed would answer "was the
 * patient told?" with a blank page. The route fetches all three in parallel and none of them
 * can take the others down.
 *
 * ------------------------------------------------------------------
 * WHY THERE IS NO "SEND A MESSAGE" BUTTON
 *
 * Because there is no endpoint behind one, and there will not be. Every message leaves
 * through a closed template catalogue; a free-text send API would be a free-text disclosure
 * API, on a channel that transits the mobile operator and lands on a lock screen. The notice
 * at the top says so, in the place where somebody would otherwise go looking for the button.
 */

export type MessagesScreenProps = {
  history: Attempt<NotificationPage>
  usage: Attempt<SmsUsage>
  catalogue: Attempt<Catalogue>
  filters: NotificationFilters
  /** This screen's own path, for the filter form and the cursor links. */
  selfPath: string
}

export function MessagesScreen({ history, usage, catalogue, filters, selfPath }: MessagesScreenProps) {
  return (
    <div className="grid">
      <PageHeader
        title="Messages"
        description={
          <>
            What this clinic sent, whether it arrived, and every message the platform is
            capable of sending.
          </>
        }
      />

      <Notice tone="info" title="Messages say that something is ready, and nothing more">
        <p>
          SMS is not a confidential channel: assume the operator can read every message and
          that it lands on a lock screen. Nothing the clinic sends carries a diagnosis, a
          medicine or a result — what a message concerns is shown in the app, behind a
          sign-in, and nowhere else. That is why there is no way to write a message by hand.
        </p>
      </Notice>

      <SmsUsagePanel usage={usage} />
      <SendHistory page={history} filters={filters} selfPath={selfPath} />
      <TemplateCatalogue catalogue={catalogue} />
    </div>
  )
}
