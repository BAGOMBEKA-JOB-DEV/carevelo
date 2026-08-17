/**
 * The import boundaries, enforced.
 *
 * These rules are the structure. Written in a README they would erode on the first
 * deadline; the backend's last three defects were all things a rule would have caught
 * and a convention did not, so the frontend's boundaries are a build gate from the
 * first commit rather than a retrofit.
 *
 * Run: pnpm boundaries          (and pnpm boundaries:graph for a picture)
 *
 * @see frontend/README.md
 * @see docs/70-decisions/0007-separate-backend-frontend-trees.md
 */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-domain-internals',
      comment:
        "A domain may not reach into another domain's internals. Import the other " +
        "domain's index.ts, or — better — compose the two in the route layer, which " +
        'is what app/ is for. Reaching inside makes two domains one domain with a ' +
        'folder between them.',
      severity: 'error',
      from: { path: 'src/domains/([^/]+)/.+' },
      to: {
        path: 'src/domains/([^/]+)/.+',
        pathNot: [
          // Same domain: fine.
          'src/domains/$1/.+',
          // Another domain's public surface: allowed, if awkward.
          'src/domains/[^/]+/index\\.(ts|tsx)$',
        ],
      },
    },
    {
      name: 'shared-must-not-know-domains',
      comment:
        'app-global code must not import from a domain. The dependency direction is ' +
        'one-way: domains depend on shared, never the reverse. A shell that imports ' +
        'an appointment component is not app-global, it is the scheduling domain in ' +
        'the wrong folder — and it drags that domain into every app that reuses it.',
      severity: 'error',
      from: { path: 'src/(components|lib)/.+' },
      to: { path: 'src/domains/.+' },
    },
    {
      name: 'packages-must-not-know-domains',
      comment:
        'packages/* is shared across APPS and must stay domain-agnostic. A shared ' +
        'component that knows about appointments is not shared.',
      severity: 'error',
      from: { path: 'packages/.+' },
      to: { path: 'apps/.+' },
    },
    {
      name: 'no-app-to-app',
      comment:
        'Apps are deployed separately so that a bug in one cannot take another down. ' +
        'An import between them undoes that. Move the shared thing into packages/ui.',
      severity: 'error',
      from: { path: 'apps/([^/]+)/.+' },
      to: { path: 'apps/(?!$1)[^/]+/.+' },
    },
    {
      name: 'routes-hold-no-logic',
      comment:
        'A route file may compose domains and render. It may not be imported BY one: ' +
        'that inverts the layering and hides business logic in the routing tree, ' +
        'where nothing looks for it.',
      severity: 'error',
      from: { path: 'src/(domains|components|lib)/.+' },
      to: { path: 'src/app/.+' },
    },
    {
      name: 'api-only-through-the-client',
      comment:
        'Every call to the Carevelo API goes through @carevelo/api-client. A raw ' +
        'fetch bypasses the session cookie, the RFC 9457 translation and the ' +
        'idempotency key — and it means a hand-written request type, which is a ' +
        'second copy of the contract that drifts silently.',
      severity: 'error',
      from: { path: 'src/.+', pathNot: 'src/lib/api\\.ts$' },
      to: { path: '^node_modules/(axios|got|node-fetch|superagent)/' },
    },
    {
      name: 'realtime-only-through-the-wrapper',
      comment:
        'Laravel Echo is imported in packages/realtime and nowhere else. That wrapper ' +
        'owns channel-name construction, which is what makes an unprefixed — and ' +
        'therefore cross-tenant — channel name impossible to build by hand.',
      severity: 'error',
      from: { pathNot: '^packages/realtime/' },
      to: { path: '^node_modules/(laravel-echo|pusher-js)/' },
    },
    {
      name: 'no-unresolvable',
      comment:
        'Every import must resolve, and this rule is what keeps the rest of this file ' +
        'honest. An import dependency-cruiser cannot resolve is invisible to every ' +
        'rule above it — so a misconfigured path alias does not produce a warning, it ' +
        'silently switches the boundary enforcement off and leaves the run green.\n\n' +
        'That happened here: the rules were written against tsconfig.base.json, which ' +
        'has no `@/*` mapping, so every `@/domains/...` import resolved to nothing and ' +
        '`shared-must-not-know-domains` could not fire on the idiomatic Next import ' +
        'style. Relative imports were caught; the ones people actually write were not. ' +
        'The boundaries script now runs per app with that app\'s own tsconfig, and this ' +
        'rule fails the build if anything ever stops resolving again.',
      severity: 'error',
      from: {},
      to: { couldNotResolve: true },
    },
    {
      name: 'no-circular',
      comment:
        'A cycle means the two modules are one module. It also breaks tree-shaking, ' +
        'which the patient portal cannot afford.',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'no-orphans',
      comment:
        'A module nothing imports is dead code. The backend shipped three such things ' +
        '— a command never scheduled, a column never written, an endpoint never routed ' +
        '— so it is worth catching here by default rather than discovering later.',
      severity: 'warn',
      from: {
        orphan: true,
        pathNot: [
          '\\.d\\.ts$',
          '(^|/)\\.[^/]+\\.(js|cjs|mjs|ts)$',
          '(^|/)(eslint|next|postcss|tailwind)\\.config\\.(js|cjs|mjs|ts)$',
          // Next.js discovers these by filename; nothing imports them.
          'src/app/.+',
          '(middleware|instrumentation)\\.ts$',
          'next\\.config\\.ts$',
          // A domain's index.ts is a PUBLIC API, and a public API is legitimately
          // unreferenced from inside its own package -- the same reason app/ routes
          // and .d.ts files are exempt above. It is also unreferenced by
          // construction while a domain is still a placeholder, and 26 warnings for
          // that would mask the one real orphan this rule exists to find.
          //
          // Note what this does NOT weaken: everything INSIDE a domain is still
          // checked, so an unused component or hook is still reported. And a domain
          // that nothing routes to is caught by a different signal entirely -- no
          // route imports it, which is visible in the dependency graph.
          'src/domains/[^/]+/index\\.ts$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    // No tsConfig here on purpose. It resolves against the CWD, and this config runs
    // both from the workspace root and from inside each package -- so the caller
    // passes --ts-config. That is also what lets each app resolve its own `@/*`
    // alias, without which the boundary rules are blind to the idiomatic import
    // style; see no-unresolvable.
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      // .d.ts is not optional here: the generated API client is a declaration file,
      // and without it `export type { components } from './generated/schema'` looked
      // unresolvable. no-unresolvable caught that on its first run, which is exactly
      // the blind spot it was added for.
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.d.ts'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(?:@[^/]+/[^/]+|[^/]+)' },
    },
  },
}
