/**
 * Keep a redirect inside this site.
 *
 * A Server Action that redirects wherever a form field told it to is an open redirector,
 * and a form field is something the person on the other side controls. On a clinic's own
 * subdomain that matters more than it usually would: the phishing link a patient has every
 * reason to trust is the one that starts at their clinic's address. Anything that is not
 * plainly a local path becomes the portal's root.
 *
 * Three refusals, and the second is the one people forget:
 *
 *   1. it must begin with a slash, so `https://evil.example` and `javascript:` URLs are
 *      out;
 *   2. it must not begin with TWO, because `//evil.example` is protocol-relative — it
 *      starts with a slash and is not local at all;
 *   3. no control characters and no backslash, both of which browsers have historically
 *      normalised in ways that turn a rejected string back into an absolute URL.
 *
 * Written as a loop rather than a regular expression on purpose: a character class holding
 * a literal control range is invisible in review and in a diff, which is the opposite of
 * what a security check should be.
 */
export function localPath(value: string): string {
  if (!value.startsWith('/') || value.startsWith('//')) {
    return '/'
  }

  for (const character of value) {
    const code = character.codePointAt(0) ?? 0

    if (code < 0x20 || code === 0x7f || character === '\\') {
      return '/'
    }
  }

  return value
}
