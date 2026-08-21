/**
 * The one vocabulary the layout primitives speak.
 *
 * WHY THE KEYS ARE THE SCALE'S OWN NUMBERS, AS STRINGS
 *
 * `var(--space-*)` already appears 404 times inline across the four apps. The values were
 * right every one of those times — people reached for the token and had nowhere to put it,
 * so they put it in a `style={{}}`. That means the migration this type has to serve is
 * mechanical: `style={{ marginTop: 'var(--space-5)' }}` becomes `gap="5"`, and nobody has
 * to decide what "medium" means on the way past.
 *
 * A second, invented vocabulary — `xs`/`sm`/`md`/`lg` — would have made every one of those
 * 404 sites a judgement call, and it would have needed a lookup table in somebody's head
 * for the rest of the product's life. There is already a scale. It has eight steps and
 * they are named 1 to 8 in spacing.css. This is that scale and nothing else.
 *
 * THEY ARE STRINGS AND NOT NUMBERS, AND THAT IS THE POINT
 *
 * `gap={16}` is the failure mode the whole layout layer exists to end: an arbitrary pixel
 * value, chosen once, drifting from the scale forever. A string union cannot be arithmetic
 * and cannot be interpolated from a variable the compiler has not seen, so the only values
 * that reach `SPACE` are the eight that exist. Raising `--space-5` from 16px to 17px stays
 * a one-line edit in spacing.css, which is the property the token layer was built to have.
 *
 * `none` is here because a zero gap is a real layout — a table wrapper, a grid whose cells
 * carry their own dividers — and `gap="0"` would have implied a `--space-0` that does not
 * exist.
 *
 * @see tokens/spacing.css — where the eight steps are defined
 */

export type Space = 'none' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8'

/**
 * Scale key to CSS value.
 *
 * Module-private on purpose, exactly as `cx` is. An app importing this to write
 * `style={{ marginTop: SPACE['5'] }}` has arrived back where it started, one indirection
 * later. The primitives are the mechanism; this is their lookup table.
 */
export const SPACE: Record<Space, string> = {
  none: '0',
  '1': 'var(--space-1)',
  '2': 'var(--space-2)',
  '3': 'var(--space-3)',
  '4': 'var(--space-4)',
  '5': 'var(--space-5)',
  '6': 'var(--space-6)',
  '7': 'var(--space-7)',
  '8': 'var(--space-8)',
}
