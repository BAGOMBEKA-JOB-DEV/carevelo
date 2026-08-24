import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

/**
 * NO INLINE SERVER ACTION MAY CAPTURE ANYTHING CALLABLE. Across all four apps.
 *
 * ====================================================================================
 * THE DEFECT THIS EXISTS FOR, AND IT SHIPPED IN SIX PLACES
 * ====================================================================================
 *
 * An inline `'use server'` function declared inside a component is compiled by Next into a
 * server reference whose BOUND ARGUMENTS are every variable it captures from the enclosing
 * scope. Those arguments are serialised — encrypted, in Next's case — at the moment the
 * closure is created, on every render, whether or not a single form is ever rendered from it.
 * `docs/01-app/02-guides/data-security.md#closures-and-encryption` in the installed Next
 * package is the reference.
 *
 * A function cannot be serialised. So a component that did the obvious, readable thing —
 *
 *     const back = (params) => href(paths.day, { day: chosenDay, ...params })
 *
 *     async function cancel(formData: FormData) {
 *       'use server'
 *       return redirect(back({ problem: 'incomplete' }))   //  <-- captures `back`
 *     }
 *
 * — threw, out of the RENDER, on every request:
 *
 *     Functions cannot be passed directly to Client Components unless you explicitly
 *     expose it by marking it with "use server". [function back]
 *
 * and left every form wired to that action pointing at bound arguments that had failed to
 * encrypt. Six components had it: the console's schedule, its assisted booking, its
 * consultation room and its prescribing panel; the rider's delivery screen; the platform
 * register's tenant panel. Between them that is cancelling an appointment, confirming an
 * unpaid one, going into a consultation, ending it, cancelling a prescription, opening a
 * prescription document, a rider recording a delivery or a failure, and suspending a clinic.
 *
 * WHY NOTHING CAUGHT IT. Every gate was green — `tsc` is happy, because closing over a
 * function is perfectly legal TypeScript; ESLint has no scope-aware rule that could see it;
 * dependency-cruiser watches imports, not closures; and the screenshot baselines were
 * IDENTICAL, because the page renders correctly and only the button is dead. It was found by
 * driving the console with a browser and reading the console output, which is not a gate.
 * The one visible symptom was Next's dev toolbar quietly wearing a badge that said "1 Issue".
 *
 * ONE OF THE SIX WAS NOT SILENT, and it is the reason this file is a test rather than a note:
 * on `/schedule/book` the throw escaped into the error boundary, so pressing "Book this
 * appointment" showed a receptionist "The schedule did not load", mid-call, with a patient on
 * the line. That is the worst outcome in the product and it was reachable from a green build.
 *
 * ====================================================================================
 * WHY IT CHECKS TYPES AND NOT JUST SYNTAX
 * ====================================================================================
 *
 * The obvious version of this check looks for captured identifiers that were DECLARED as
 * functions. That version would have missed the second half of the same fault, which is one
 * level down and much easier to write by accident:
 *
 *     const back = ...             // a function — obvious
 *     redirect(href(paths.day, …)) // `paths` is a plain object — and `SchedulePaths` is
 *                                  // `{ day: string; book: string; room: (id) => string }`
 *
 * An object with a function ANYWHERE inside it is exactly as unserialisable as the function.
 * `AssistedBooking` captured both, and React reports only the first thing it trips over — so
 * fixing the obvious one would have left the screen just as broken and the error message
 * unchanged. This walks the TYPE of every captured binding, so `paths` is caught for what it
 * carries rather than for how it was written.
 *
 * Properties declared in `node_modules` or in TypeScript's own lib are skipped. Without that,
 * every captured `string` fails on `String.prototype.charAt` and the check reports everything,
 * which is the same as reporting nothing.
 *
 * ====================================================================================
 * WHY A WORKSPACE-WIDE SCAN LIVES IN ONE APP'S TEST DIRECTORY
 * ====================================================================================
 *
 * Because there are only two vitest projects — patient-portal and clinic-console — and the
 * defect was in all four apps. rider-view and platform-admin declare no vitest, and adding it
 * to them means a devDependency plus the matching lockfile entry, which is a change to how
 * the workspace installs rather than a test. vitest.config.ts states the rule this obeys: a
 * file matching `*.test.ts` should be a file that RUNS. So the scan is rooted at `apps/`
 * rather than at this app, and it runs from the project that already exists — the same move
 * packages/ui's tokens test makes when it reads its own directory off disk.
 *
 * It is a source scan and not a render, so it needs no DOM, no server and no seeded tenant.
 * It is honest about its limit too: it proves that nothing CALLABLE is captured. It cannot
 * prove that everything else is serialisable — a captured `Map`, a class instance or a
 * `Symbol` would also fail at runtime and is not the mistake anyone here has made.
 *
 * @see apps/clinic-console/src/domains/scheduling/components/DayView.tsx — the fix, in full
 * @see vitest.config.ts — why there are only two projects
 */

/**
 * `frontend/apps/`, resolved from this file rather than from the working directory.
 *
 * `fileURLToPath` rather than `new URL('../../', import.meta.url).pathname`, which is the
 * shorter spelling and does not work here: Vite recognises that exact expression and rewrites
 * it into an ASSET url, so the scan went looking for a directory called `/@fs/...` and found
 * nothing. Everything below would then have passed on zero files.
 */
const APPS = join(dirname(fileURLToPath(import.meta.url)), '..', '..') + '/'

/** Every `.ts`/`.tsx` under a directory, skipping build output. */
function sources(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.next') {
      continue
    }

    const path = join(dir, entry)

    if (statSync(path).isDirectory()) {
      sources(path, found)
    } else if (path.endsWith('.ts') || path.endsWith('.tsx')) {
      found.push(path)
    }
  }

  return found
}

/**
 * Is this function an inline server action — a `'use server'` as its FIRST statement?
 *
 * A file-level `'use server'` module is a different thing entirely and is not in scope here:
 * its exports are top-level functions that capture nothing, which is exactly why the domains
 * that put their actions in `api/actions.ts` never had this defect.
 */
function isInlineAction(node: ts.Node): node is ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction {
  if (!ts.isFunctionDeclaration(node) && !ts.isFunctionExpression(node) && !ts.isArrowFunction(node)) {
    return false
  }

  const body = node.body

  if (body === undefined || !ts.isBlock(body)) {
    return false
  }

  const first = body.statements[0]

  return (
    first !== undefined
    && ts.isExpressionStatement(first)
    && ts.isStringLiteral(first.expression)
    && first.expression.text === 'use server'
  )
}

/** The enclosing function scopes of a node, innermost first. Empty means module scope. */
function enclosingFunctions(node: ts.Node): ts.Node[] {
  const scopes: ts.Node[] = []

  for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
    if (
      ts.isFunctionDeclaration(parent)
      || ts.isFunctionExpression(parent)
      || ts.isArrowFunction(parent)
      || ts.isMethodDeclaration(parent)
    ) {
      scopes.push(parent)
    }
  }

  return scopes
}

/** The primitives, which are serialisable and whose lib methods must not be walked into. */
const PRIMITIVE =
  ts.TypeFlags.String | ts.TypeFlags.Number | ts.TypeFlags.Boolean | ts.TypeFlags.BigInt
  | ts.TypeFlags.StringLiteral | ts.TypeFlags.NumberLiteral | ts.TypeFlags.BooleanLiteral
  | ts.TypeFlags.BigIntLiteral | ts.TypeFlags.EnumLike | ts.TypeFlags.ESSymbolLike
  | ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void | ts.TypeFlags.Never
  | ts.TypeFlags.Any | ts.TypeFlags.Unknown

/**
 * Does this type carry a function anywhere a serialiser would reach?
 *
 * Only properties declared in OUR OWN source are followed. A `string` has `charAt`, a
 * `Date` has `toISOString`, and following those would make every captured value a failure.
 */
function carriesAFunction(
  checker: ts.TypeChecker,
  type: ts.Type,
  depth = 0,
  seen = new Set<string>(),
): boolean {
  if (depth > 6) {
    return false
  }

  if (type.isUnionOrIntersection()) {
    return type.types.some((member) => carriesAFunction(checker, member, depth + 1, seen))
  }

  if ((type.flags & PRIMITIVE) !== 0) {
    return false
  }

  if (
    checker.getSignaturesOfType(type, ts.SignatureKind.Call).length > 0
    || checker.getSignaturesOfType(type, ts.SignatureKind.Construct).length > 0
  ) {
    return true
  }

  // Structural identity, because a recursive type would otherwise never bottom out.
  const seenKey = checker.typeToString(type)

  if (seen.has(seenKey)) {
    return false
  }

  seen.add(seenKey)

  if (checker.isArrayType(type) || checker.isTupleType(type)) {
    return checker
      .getTypeArguments(type as ts.TypeReference)
      .some((argument) => carriesAFunction(checker, argument, depth + 1, seen))
  }

  for (const property of checker.getPropertiesOfType(type)) {
    const declarations = property.declarations ?? []
    const ours = declarations.filter(
      (declaration) => !/node_modules|typescript[/\\]lib/.test(declaration.getSourceFile().fileName),
    )
    const declaration = ours[0]

    if (declaration === undefined) {
      continue
    }

    if (carriesAFunction(checker, checker.getTypeOfSymbolAtLocation(property, declaration), depth + 1, seen)) {
      return true
    }
  }

  return false
}

/**
 * Every `<file>:<line> captures <name>` an app would fail on, as sentences.
 *
 * Sentences rather than a count, because the value of this test is entirely in what it says
 * when it goes red: the next person to hit this will not know the rule, and "captures `paths`
 * (SchedulePaths)" plus the file and line is the whole diagnosis.
 */
function offences(appDir: string): string[] {
  const withActions = sources(join(appDir, 'src')).filter((file) =>
    readFileSync(file, 'utf8').includes("'use server'"),
  )

  if (withActions.length === 0) {
    return []
  }

  /*
   * Rooted at the files that contain an action rather than at the whole app: TypeScript pulls
   * in everything they import, which is all the checker needs, and skips the rest. The options
   * mirror tsconfig.base.json plus each app's own `@/*` mapping. Nothing is emitted.
   */
  const program = ts.createProgram(withActions, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    baseUrl: appDir,
    paths: { '@/*': ['./src/*'] },
  })
  const checker = program.getTypeChecker()
  const found: string[] = []

  for (const file of withActions) {
    const source = program.getSourceFile(file)

    if (source === undefined) {
      continue
    }

    const inspect = (node: ts.Node): void => {
      if (isInlineAction(node)) {
        const scopes = enclosingFunctions(node)

        // A module-level action captures nothing. Only a nested one can.
        if (scopes.length > 0) {
          const captured = new Map<string, ts.Identifier>()

          const collect = (inner: ts.Node): void => {
            const isPropertyName =
              (ts.isPropertyAccessExpression(inner.parent) && inner.parent.name === inner)
              || (ts.isPropertyAssignment(inner.parent) && inner.parent.name === inner)

            if (ts.isIdentifier(inner) && !isPropertyName) {
              const symbol = checker.getSymbolAtLocation(inner)
              const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0]

              if (declaration !== undefined && declaration.getSourceFile() === source) {
                const fromEnclosingScope = scopes.some(
                  (scope) => declaration.pos >= scope.pos && declaration.end <= scope.end,
                )
                const declaredInsideTheAction = declaration.pos >= node.pos && declaration.end <= node.end

                if (fromEnclosingScope && !declaredInsideTheAction && !captured.has(inner.text)) {
                  captured.set(inner.text, inner)
                }
              }
            }

            ts.forEachChild(inner, collect)
          }

          ts.forEachChild(node.body as ts.Node, collect)

          for (const [name, reference] of captured) {
            const symbol = checker.getSymbolAtLocation(reference)

            if (symbol === undefined) {
              continue
            }

            const type = checker.getTypeOfSymbolAtLocation(symbol, reference)

            if (carriesAFunction(checker, type)) {
              const { line } = source.getLineAndCharacterOfPosition(node.getStart(source))

              found.push(
                `${file.slice(APPS.length)}:${line + 1} — the inline 'use server' function `
                + `captures \`${name}\` (${checker.typeToString(type)}), which is not `
                + 'serialisable. Reduce it to plain data before the action, and put any helper '
                + 'it needs at module scope.',
              )
            }
          }
        }
      }

      ts.forEachChild(node, inspect)
    }

    inspect(source)
  }

  return found
}

const APP_NAMES = readdirSync(APPS).filter((entry) => statSync(join(APPS, entry)).isDirectory())

describe('inline server actions', () => {
  /*
   * Sixty seconds because each app gets its own TypeScript program, which is a few seconds of
   * real work — the same order as one `tsc --noEmit`, and vitest's five-second default would
   * fail on a cold machine for a reason that is not the rule.
   */
  it.each(APP_NAMES)('capture nothing callable — %s', (app) => {
    expect(offences(join(APPS, app))).toEqual([])
  }, 60_000)

  // If this ever reads zero, the scan has stopped finding the apps and every case above is
  // passing vacuously — which is the failure mode this whole file was written about.
  it('scanned all four apps', () => {
    expect(APP_NAMES).toHaveLength(4)
  })
})
