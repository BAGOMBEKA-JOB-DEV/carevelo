import type { ReactElement } from 'react'
import { getTranslations } from 'next-intl/server'
import { Skeleton, Stack } from '@carevelo/ui'

/**
 * The terms of use, held in place while the clinic is resolved.
 *
 * The same shape and the same argument as privacy/loading.tsx, and a separate file because
 * `/terms` and `/privacy` are sibling segments — Next walks up from the failing segment, and
 * neither is underneath the other, so a shared fallback would have to sit at the app root
 * and would then stand in for the front page as well.
 *
 * TWO STRINGS ARE REAL HERE WHERE PRIVACY HAS ONE. "Terms of use" and "What you can expect
 * from the clinic, what the portal does, and what it is not for." both take no arguments, so
 * both are rendered. The heading between them is "Using {clinic}'s patient portal." and is
 * reserved, which leaves this fallback with a real eyebrow, a grey heading and a real lede.
 * That is deliberately not tidied up: the sentence is true of every clinic on the platform
 * and it tells somebody who has just tapped a footer link what they have opened.
 *
 * WHAT IS NOT RESERVED IS THE EMERGENCY NOTICE. The real page opens the document with a
 * tinted band saying this portal is not for an emergency and, where the clinic has published
 * a number, the number to call instead. A grey rectangle standing in for it would be a
 * safety notice reserved but not stated, in the one position on the page where a reader
 * expects the most urgent thing. It arrives with the page, and the paragraphs below it move
 * down by its height when it does.
 */
export default async function TermsLoading(): Promise<ReactElement> {
  const t = await getTranslations('Terms')

  return (
    <div className="site-root">
      <main>
        <div className="site-pagehero">
          <Stack gap="4">
            <span className="site-eyebrow">{t('eyebrow')}</span>
            <Skeleton lines={1} className="title-lg" />
            <p className="site-lede">{t('lede')}</p>
          </Stack>
        </div>

        <div className="site-doc">
          <Stack gap="7">
            {Array.from({ length: 4 }, (_unused, index) => (
              <Stack gap="4" key={index}>
                <Skeleton lines={1} className="title-sm" />
                <Skeleton lines={4} />
              </Stack>
            ))}
          </Stack>
        </div>
      </main>
    </div>
  )
}
