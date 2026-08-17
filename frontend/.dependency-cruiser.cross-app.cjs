/**
 * The one rule that needs to see the whole workspace at once.
 *
 * Everything else is enforced per package, from inside that package, because that is
 * the only way each app's own `@/*` alias resolves — and an import the resolver cannot
 * see is an import no rule can judge.
 *
 * But a per-app run cannot recognise an import of ANOTHER app: from inside
 * apps/rider-view, a reach into the console is just `../../clinic-console/...`, which
 * says nothing about app boundaries. That needs the root view, so it gets its own
 * config with `no-unresolvable` deliberately absent — at root level the aliases do not
 * resolve, and firing on all of them here would bury the one thing this run is for.
 *
 * Run by `pnpm boundaries`, after the per-package pass.
 */
module.exports = {
  forbidden: [
    {
      name: 'no-app-to-app',
      comment:
        'Apps are deployed separately so a bug in one cannot take another down, and so ' +
        "the rider's bundle cannot contain a prescribing form. An import between them " +
        'undoes both. Move the shared thing into packages/ui — and if it cannot go ' +
        'there because it knows about a domain, it should not be shared at all.',
      severity: 'error',
      from: { path: 'apps/([^/]+)/.+' },
      to: { path: 'apps/(?!$1)[^/]+/.+' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    tsPreCompilationDeps: true,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.d.ts'],
    },
  },
}
