import { Button, Icon } from '@carevelo/ui'

/**
 * Tap to call the recipient.
 *
 * ------------------------------------------------------------
 * WHY THIS IS A BUTTON-SHAPED LINK AND NOT A LINE OF TEXT
 *
 * The single most common thing a rider does at an address is telephone the person they
 * are delivering to. Doing it from a number they have to read off a screen, memorise and
 * key into a dialler — outdoors, wearing a helmet, one hand on a bike — is where the
 * minutes go and where the wrong digit gets typed. `tel:` hands the number straight to
 * the dialler, and every mobile browser this product targets supports it.
 *
 * IT IS ALSO WHY "recipient phone" IS ONE OF THE FOUR FIELDS A RIDER IS ALLOWED. The
 * minimisation rule permits exactly recipient name, recipient phone, delivery address and
 * a package reference, and the phone number is on that list because a delivery that
 * cannot be completed without it becomes a failed delivery and a second trip.
 *
 * THE NUMBER IS SHOWN AS WELL AS DIALLED. A rider on a handset whose dialler is not
 * wired up, or who wants to use a different SIM, still needs to be able to read it — and
 * an accessible name of "Call" with no number attached tells a screen-reader user
 * nothing about who they are about to ring.
 *
 * ------------------------------------------------------------
 * WHAT IS DELIBERATELY ABSENT
 *
 * No WhatsApp link, no SMS link, no "message the patient". Both of those channels are
 * untrusted transports that leave the platform unencrypted and land on a lock screen, and
 * the notifications rule is that they never carry clinical content. A rider composing
 * free text to a patient is the shortest path from this screen to a message that names a
 * medicine. A voice call leaves no payload for us to have written.
 */
export function CallRecipient({
  name,
  phone,
  /** `lg` on the detail screen, where it is a primary action. `md` in a list row. */
  size = 'md',
  block = false,
}: {
  name: string
  phone: string
  size?: 'md' | 'lg' | undefined
  block?: boolean | undefined
}) {
  return (
    <Button
      href={`tel:${dialable(phone)}`}
      variant="primary"
      size={size}
      block={block}
      /* The visible label is "Call" plus the number; the accessible name adds who is being
         called, because a screen-reader user moving through a list of assignments hears
         these links out of context. */
      aria-label={`Call ${name} on ${phone}`}
    >
      <Icon name="phone" />
      Call {phone}
    </Button>
  )
}

/**
 * The number as a dialler will accept it.
 *
 * Spaces, brackets and dashes are stripped because a `tel:` URI treats them as visual
 * separators that some diallers keep and then fail to parse; `+` is kept, because Ugandan
 * numbers are stored in international form (`UgandanPhone` normalises them on the way in)
 * and dropping it turns a working number into a local one that may not resolve on another
 * network.
 *
 * Nothing is validated here. The number came from the clinic's own record via the API,
 * and a rider staring at a hidden "Call" button because our regular expression disagreed
 * with a legitimately-formatted number is a worse outcome than a dialler being handed
 * something it refuses.
 */
function dialable(phone: string): string {
  return phone.replace(/[^\d+]/g, '')
}
