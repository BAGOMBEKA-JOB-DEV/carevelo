import { getRequestConfig } from 'next-intl/server'
import { activeLocale } from './locale'
import { MESSAGES } from './messages'

/**
 * next-intl's per-request configuration.
 *
 * FOUND BY FILENAME, NOT BY IMPORT. `createNextIntlPlugin()` in next.config.ts aliases
 * `next-intl/config` to `./src/i18n/request.ts`, which is why nothing in the tree imports
 * this file and why deleting it would break the app without breaking a single import.
 *
 * NO `requestLocale` PARAMETER. That argument carries the `[locale]` URL segment, and this
 * app deliberately has none — see locales.ts for why the tenant's host is the only routing
 * dimension here. The locale comes from `activeLocale()`, the same function the rest of the
 * app resolves it through, which today returns the one language the portal holds and is the
 * single place a second one would be chosen.
 *
 * THE TIME ZONE IS SET HERE AND NOWHERE ELSE, and it is the reason this file would still be
 * needed even if the portal only ever spoke one language. Every timestamp this product
 * shows a human is Kampala time — the patients, the clinics and the riders are all there —
 * and left unset, next-intl formats in the SERVER's zone. An appointment rendered three
 * hours out is an appointment somebody misses, and on a date boundary it is the wrong day
 * rather than the wrong hour, which does not even look like a timezone bug.
 */
export default getRequestConfig(async () => {
  const locale = await activeLocale()

  return {
    locale,
    messages: MESSAGES[locale],
    timeZone: 'Africa/Kampala',
  }
})
