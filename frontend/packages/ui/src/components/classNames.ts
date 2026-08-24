/**
 * Join class names, dropping the absent ones.
 *
 * Deliberately not a dependency. `clsx` is 400 bytes and does more than this — objects,
 * nested arrays, numbers — and every one of those extra shapes is a way for a class list
 * to be built somewhere other than in a component. The patient portal's first-load budget
 * is 150KB for the booking path; a package this layer can write in four lines is not worth
 * a byte of it, nor a supply-chain surface on a tree that renders health records.
 *
 * Module-private. It is not exported from the package: an app assembling `.btn btn-brand`
 * by hand is the exact duplication the component layer exists to stop, and giving them the
 * helper to do it with would be an odd way to start. `buttonClass()` is the sanctioned
 * escape hatch, and it is one function with one job.
 */
export function cx(
  ...parts: ReadonlyArray<string | false | null | undefined>
): string {
  return parts.filter((part): part is string => typeof part === 'string' && part !== '').join(' ')
}
