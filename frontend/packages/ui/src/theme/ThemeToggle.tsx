'use client'

import { useEffect, useState } from 'react'
import { Icon } from '../icons/Icon'

/**
 * The theme switch: a 38px hairline square holding a sun or a moon.
 *
 * THE DOM IS THE SOURCE OF TRUTH, NOT THIS COMPONENT.
 * public/theme-init.js has already read localStorage and set (or not set) data-theme on
 * <html> before anything painted. If this component held its own default and rendered
 * from that, it would be guessing at something already decided a few milliseconds
 * earlier — and it would guess wrong for exactly the users who care, the ones who chose
 * dark. So every read goes to `document.documentElement.dataset.theme`, on mount and
 * again on every click. React state here exists only to re-render the icon; it is a
 * mirror of the attribute, never the record of it.
 *
 * WHY THE STATE STARTS null
 * `document` does not exist during the server render, and the theme is in localStorage,
 * which the server could not read even if it did. `null` means "not yet known", and it
 * is what BOTH the server render and the first client render produce — which is the
 * whole point, because a first client render that disagreed with the server's HTML is a
 * hydration error, and React would discard and re-render the tree to resolve it. The
 * effect fills it in immediately after.
 *
 * WHAT THE SERVER EMITS, AND WHY IT IS THE MOON
 * The button renders fully server-side — right size, right border, in the header — so
 * nothing shifts when the bundle lands. It just cannot do anything yet: there is no
 * click handler in static HTML, and that is unavoidable for a control whose entire job
 * is to write to browser storage.
 *
 * The icon has to be one of the two, so it is the moon: light is the default and the
 * absence of the attribute, so the moon ("go to dark") is correct for every first-time
 * visitor and everyone who has never toggled. A returning patient in dark mode sees a
 * moon on a dark page for the one frame before hydration, then a sun. That is a brief
 * cosmetic wrongness for a minority, chosen over a control that is missing, or that
 * changes size, for everybody.
 *
 * The ARIA, though, is never wrong — it says less rather than something false. Until the
 * attribute has been read there is no `aria-pressed` at all (an unpressed toggle would
 * be a claim we cannot support) and the label names the action generically. A screen
 * reader user tabbing here in that window is told what the button is for and nothing it
 * might have to unlearn. The reference product this is ported from omits aria-pressed
 * entirely, which leaves a two-state control announced as a plain button; we do not.
 *
 * Once mounted, the label names the DESTINATION rather than the current state — "Switch
 * to dark mode" — because that is what pressing it does, and a label that describes
 * where you already are is the classic way to make a toggle ambiguous.
 *
 * No styles here and no CSS-in-JS. `.site-theme-btn` lives in the token layer with the
 * rest of the marketing chrome, so the geometry of this button is reviewable next to the
 * header it sits in.
 */

type Theme = 'light' | 'dark'

/* The same key as public/theme-init.js, which cannot import it — a plain file served to
   the browser has no module graph. Kept module-private so there is exactly one place in
   TypeScript that spells it, and the duplication with the init script is a single,
   commented pair rather than a string scattered around. */
const STORAGE_KEY = 'carevelo.theme'

function readTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme | null>(null)

  useEffect(() => {
    setTheme(readTheme())
  }, [])

  function toggle() {
    /* Read the attribute rather than trusting `theme`: the DOM is the record, and it can
       have moved under us — a second toggle in another tab, or a click that lands before
       the mount effect has run. */
    const next: Theme = readTheme() === 'dark' ? 'light' : 'dark'

    if (next === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark')
    } else {
      /* Removed, not set to 'light'. Light is the absence of the attribute, so that all
         light values can live on bare :root and there is one code path into them. */
      document.documentElement.removeAttribute('data-theme')
    }

    setTheme(next)

    try {
      /* 'light' is stored explicitly rather than the key being deleted. "I chose light"
         and "I have never chosen" look identical to theme-init.js today, but only one of
         them should survive us ever changing what the default is. */
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      /* Private browsing, or a device policy that blocks storage. The theme still changed
         for this page; it just will not be remembered. Losing the preference is an
         acceptable outcome. Throwing out of a click handler is not. */
    }
  }

  const dark = theme === 'dark'

  return (
    <button
      type="button"
      className="site-theme-btn"
      onClick={toggle}
      aria-pressed={theme === null ? undefined : dark}
      aria-label={
        theme === null
          ? 'Switch colour theme'
          : dark
            ? 'Switch to light mode'
            : 'Switch to dark mode'
      }
    >
      <Icon name={dark ? 'sun' : 'moon'} />
    </button>
  )
}
