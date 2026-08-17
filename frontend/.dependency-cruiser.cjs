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
      from: { path: 'apps/[^/]+/src/domains/([^/]+)/.+' },
      to: {
        path: 'apps/[^/]+/src/domains/([^/]+)/.+',
        pathNot: [
          // Same domain: fine.
          'apps/[^/]+/src/domains/$1/.+',
          // Another domain's public surface: allowed, if awkward.
          'apps/[^/]+/src/domains/[^/]+/index\\.(ts|tsx)$',
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
      from: { path: 'apps/[^/]+/src/(components|lib)/.+' },
      to: { path: 'apps/[^/]+/src/domains/.+' },
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
      from: { path: 'apps/[^/]+/src/(domains|components|lib)/.+' },
      to: { path: 'apps/[^/]+/src/app/.+' },
    },
    {
      name: 'api-only-through-the-client',
      comment:
        'Every call to the Carevelo API goes through @carevelo/api-client. A raw ' +
        'fetch bypasses the session cookie, the RFC 9457 translation and the ' +
        'idempotency key — and it means a hand-written request type, which is a ' +
        'second copy of the contract that drifts silently.',
      severity: 'error',
      from: { path: 'apps/[^/]+/src/.+', pathNot: 'apps/[^/]+/src/lib/api\\.ts$' },
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
          'apps/[^/]+/src/app/.+',
          'apps/[^/]+/(middleware|instrumentation)\\.ts$',
        ],
      },
      to: {},
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'],
    },
    reporterOptions: {
      dot: { collapsePattern: 'node_modules/(?:@[^/]+/[^/]+|[^/]+)' },
    },
  },
}
