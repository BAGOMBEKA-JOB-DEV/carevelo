import { Inline } from '@carevelo/ui'
import { getLocale, getTranslations } from 'next-intl/server'
import { chooseLocale } from '@/i18n/actions'
import { LOCALES } from '@/i18n/locales'

/**
 * The language control, and the one control on this surface that has to work for somebody
 * who cannot read the page it is on.
 *
 * TWO SUBMIT BUTTONS IN ONE FORM, NOT A <select>. A select needs an onChange handler to do
 * anything, which means it needs the bundle, which means it is dead for the first seconds
 * of a page load on the mid-range Android phone on variable mobile data that this product
 * is built for — and permanently dead with JavaScript off. A submit button carries its own
 * `name` and `value` in a native POST, so the browser alone is enough: the form posts to
 * the URL it was rendered on, the server action writes the cookie, and the same URL comes
 * back in the other language. No JavaScript anywhere in that sentence.
 *
 * EACH LANGUAGE IS NAMED IN ITS OWN LANGUAGE, in both catalogues — English and Oluganda,
 * identical either side. The alternative is to translate the option labels, which reads
 * more correct and is the trap: a patient who lands on Luganda by accident, or who taps
 * the wrong button, would then be looking for the word "English" and finding "Olungereza".
 * A language switch has to be reversible by somebody who cannot read the current language,
 * so the labels are the one thing that must not change with it. `lang` on each button
 * tells a screen reader to pronounce them accordingly.
 *
 * SERVER COMPONENT, so this ships no JavaScript at all. The active language is marked with
 * aria-current rather than by disabling the button: a disabled control cannot be focused,
 * and a keyboard user tabbing through the footer would find a gap where the current
 * language should be announced.
 */
export async function LanguageSwitcher() {
  const [locale, t] = await Promise.all([getLocale(), getTranslations('Language')])

  return (
    /* NO INLINE STYLE AND NO `<Stack>`. This form is one of four blocks inside a footer
       column whose rhythm is set by margins on the ELEMENTS themselves — `.site-footer`
       already styles its own `p`, `h4` and `ul` in tokens/site.css — so there is no column
       here for a Stack to be, and wrapping the four would replace four different distances
       with one. The 18px above this form is stated where the other three are, as
       `.site-footer form`. */
    <form action={chooseLocale}>
      {/* A fieldset because these two buttons are one choice. The legend says what the
          choice is for people who hear the page rather than see it; sighted readers have
          the heading above and do not need it twice.

          The browser's own border, inline margin and asymmetric padding are cleared by
          `.site-footer fieldset` in tokens/site.css. That is a USER-AGENT correction rather
          than a layout decision, and it is scoped to the footer rather than put in the
          shared reset — which all four apps download — because this is the only fieldset on
          the surface and a fieldset somebody writes elsewhere should still arrive with the
          frame the browser gives it. */}
      <fieldset>
        <legend className="sr-only">{t('legend')}</legend>

        <h4>{t('heading')}</h4>

        {/* `Inline` rather than a hand-rolled flex row: 8px between two buttons that
            must be allowed to fall onto separate lines when a clinic's name pushes the
            footer column narrow. */}
        <Inline gap="3">
          {LOCALES.map((candidate) => {
            const active = candidate === locale

            return (
              <button
                key={candidate}
                type="submit"
                name="locale"
                value={candidate}
                lang={candidate}
                className={`btn btn-sm ${active ? 'btn-brand' : 'btn-quiet'}`}
                aria-current={active ? 'true' : undefined}
              >
                {t(`options.${candidate}`)}
              </button>
            )
          })}
        </Inline>
      </fieldset>
    </form>
  )
}
