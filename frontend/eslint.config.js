import js from '@eslint/js'
import nextPlugin from '@next/eslint-plugin-next'
import reactHooks from 'eslint-plugin-react-hooks'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * The workspace lint configuration.
 *
 * This file exists because its absence was a silent failure of exactly the kind this
 * project keeps finding. A `lint` script was wired into every package and into the
 * composite `pnpm check` gate, and never run — so `pnpm check` exited 2 while reading
 * as though the workspace had a linter. The same shape as the console command that was
 * never scheduled and the column nothing ever wrote.
 *
 * THE DOMAIN IMPORT BOUNDARIES ARE NOT HERE. They live in .dependency-cruiser.cjs,
 * where they are proven to fail on a planted violation through both relative and
 * aliased imports.
 *
 * I tried to express them here as well, so they would surface in the editor rather
 * than ten minutes later in CI. eslint-plugin-boundaries would not classify the files:
 * every pattern I gave it left `boundaries/no-unknown-files` reporting the source file
 * itself as belonging to no element, which means no policy applied and the rule was
 * passing without checking anything.
 *
 * So it was removed rather than left in. A rule that cannot fire is worse than no rule
 * — it manufactures exactly the confidence this project keeps having to take apart: a
 * command that was never scheduled, a column nothing wrote, a boundary check silently
 * resolving `@/` to nothing. One authoritative enforcement that demonstrably bites
 * beats two where one is decoration.
 *
 * What stays here is what does work and is proven below: unused code, `any`, restricted
 * imports for the transport and HTTP clients, and Next's own rules.
 *
 * @see frontend/.dependency-cruiser.cjs — where the boundaries are enforced
 * @see frontend/README.md
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      // Generated from docs/40-api/openapi.yaml and committed. Linting it would mean
      // editing it, which is the one thing that must not happen.
      'packages/api-client/src/generated/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      /*
       * Where a library may be imported from.
       *
       * Echo and pusher-js in packages/realtime and nowhere else: that wrapper owns
       * channel-name construction, which is what makes an unprefixed — and therefore
       * cross-tenant — channel name impossible to build by hand.
       */
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'laravel-echo',
              message:
                'Import Echo only in packages/realtime. That wrapper owns channel-name '
                + 'construction, so a cross-tenant channel name cannot be built by hand.',
            },
            {
              name: 'pusher-js',
              message: 'Only packages/realtime talks to the broadcast transport.',
            },
            {
              name: 'axios',
              message:
                'Use @carevelo/api-client. A raw HTTP client bypasses the session cookie, '
                + 'the RFC 9457 translation and the idempotency key — and means a '
                + 'hand-written request type, which is a second copy of the contract.',
            },
          ],
        },
      ],

      // An unused export is usually a half-finished thought; an unused argument is
      // usually a signature that changed. Both are worth a word.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],

      // `any` erases the contract the generated client exists to provide.
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },

  // packages/realtime is the sanctioned home for the transport.
  {
    files: ['packages/realtime/**/*.{ts,tsx}'],
    rules: { 'no-restricted-imports': 'off' },
  },

  // The apps: Next's own rules, plus the hooks rules.
  {
    files: ['apps/*/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      // App Router: there is no pages/ directory for this rule to reason about.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  /*
   * INLINE STYLE IS BANNED IN APP CODE, and the number behind this rule is 477.
   *
   * That is how many `style={{...}}` there were across the four apps when this landed: 185
   * hand-set marginTop, 171 hand-set gap, 49 hand-set fontSize. None of it was careless —
   * `var(--space-*)` appears inline 404 times, so people reached for the RIGHT token and
   * had nowhere to put it. The design system had components and no layout layer.
   *
   * It has one now: Stack, Inline, Grid, PageHeader, Stat, Toolbar, DataTable in
   * @carevelo/ui, whose spacing props take scale KEYS rather than numbers, so a caller
   * cannot reintroduce an arbitrary value even by accident.
   *
   * This rule is what stops the 477 coming back. This repo's own eslint config says it
   * elsewhere: a rule that cannot fire is worse than no rule, and a convention that lives
   * only in a README erodes on a deadline.
   *
   * THE ONE SANCTIONED EXCEPTION is the clinic's brand tokens, which are genuinely dynamic
   * — they arrive per tenant from the API and are set as a style OBJECT precisely so no
   * tenant value is ever concatenated into markup. `brandStyle()` and `fontStyle` are
   * allow-listed by name below; anything else that truly must be dynamic should join them
   * here with a comment, rather than being disabled at the call site.
   */
  {
    /*
     * SCOPED, AND THE SCOPE IS A RATCHET.
     *
     * Every app belongs in this list; only the ones already swept are in it. A gate that
     * lands red is a gate somebody disables on a deadline, so it lands green over the two
     * surfaces that are clean and widens as each of the others is finished. The remaining
     * counts are the work left, and they are meant to be read as a countdown:
     *
     *   rider-view       9
     *   platform-admin   25
     *   patient-portal   200
     *   clinic-console   243
     *
     * Adding a path to this array is the LAST step of sweeping an app, and it is the step
     * that makes the sweep stick. The two smallest apps are listed first because they are
     * small enough to finish, which makes them the proof the approach works before it is
     * pointed at the two big ones.
     *
     * PACKAGES/UI IS DELIBERATELY NOT IN SCOPE, and briefly was by mistake. It caught two
     * lines immediately: EmptyState's action margin and PageHeader's eyebrow, both
     * token-valued, both commented, both correct. A primitive's whole job is to make one
     * spacing decision so that no screen has to; doing that with `var(--space-5)` inline is
     * the layout layer working, not leaking. The thing worth banning is a LAYOUT DECISION
     * TAKEN ON A SCREEN — and that is what `apps/` means here.
     */
    files: ['apps/rider-view/**/*.tsx', 'apps/platform-admin/**/*.tsx'],
    ignores: ['apps/*/src/app/layout.tsx', 'apps/*/src/components/Site*.tsx'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'JSXAttribute[name.name="style"] > JSXExpressionContainer > ObjectExpression',
          message:
            'Inline style is banned in app code. Use Stack, Inline, Grid, PageHeader or Stat from @carevelo/ui — their spacing props take scale keys, so the value stays in the token layer. The clinic brand tokens are the one exception and are already allow-listed.',
        },
      ],
    },
  },

  // Tests reach for the filesystem and for deliberately wrong types when proving a
  // runtime guard holds against input the compiler says cannot happen.
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },

  // Config files are CommonJS and describe rules rather than obey them.
  {
    files: ['*.cjs', '*.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
)
