import { getTranslations } from 'next-intl/server'
import { Card, Notice, Stack } from '@carevelo/ui'

/**
 * Messages inside the consultation — the place they belong, and the truth about it today.
 *
 * CHAT IS ALWAYS AVAILABLE ALONGSIDE VIDEO AND VOICE, not only as a fallback. That is the
 * product rule, and it is why this panel is rendered in every mode rather than appearing
 * when something fails: it is for sharing text that is awkward spoken aloud as much as for
 * a connection that will not carry a voice.
 *
 * AND THERE IS NO ENDPOINT FOR IT. `chat` exists as a ConsultationMode and nowhere else —
 * there is no message model, no table, no route in routes/api.php, and nothing in the
 * generated client. So this panel holds the place and says plainly that typing here would
 * reach nobody, which is the one thing a composer box would hide. A message box that
 * silently drops what a patient types about their own health is worse than no box, and
 * "a plausible empty state for a feature that does not exist" is exactly what
 * `<EmptyState>` refuses to be used for — hence `<Notice>` here.
 *
 * WHAT LANDS HERE WHEN THE ENDPOINT EXISTS: a transcript rendered on the server, and a
 * `<form action={sendMessage}>` that posts natively so a patient without JavaScript can
 * still write. Chat inside a consultation is clinical data — stored in-tenant, under
 * row-level security, shown in-app under authentication, and never sent by SMS.
 *
 * @see docs/30-architecture/realtime-and-video.md — degradation; chat is not a fallback
 */
export async function ChatPanel({ clinic }: { clinic: string }) {
  const t = await getTranslations('Consultations')

  return (
    <Card as="section" aria-labelledby="consultation-chat">
      <Stack gap="4">
        <h2 className="title" id="consultation-chat">
          {t('chatTitle')}
        </h2>

        <Notice tone="neutral" icon="mail" title={t('chatUnavailableTitle')}>
          {t('chatUnavailableBody', { clinic })}
        </Notice>
      </Stack>
    </Card>
  )
}
