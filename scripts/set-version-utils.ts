// Pure helpers consumed by `set-version.ts`. Kept side-effect-free so
// the unit tests in `set-version-utils.test.ts` can exercise them
// without running the full publish-time version-stamp pipeline.

export interface MutablePackageJson {
  name?: string;
  version?: string;
  private?: boolean;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
}

const DEP_FIELDS = [
  'dependencies',
  'peerDependencies',
  'devDependencies',
  'optionalDependencies',
] as const;

/**
 * Rewrite every `@prisma-next/*` workspace dep spec in `packageJson`
 * to `workspace:<version>`. Mutates in place. Idempotent: re-running
 * with the same version is a no-op.
 *
 * The literal-version form is the mechanism that gives every published
 * `@prisma-next/*` package an exact-version pin on its `@prisma-next/*`
 * siblings: pnpm rewrites `workspace:<X.Y.Z>` to exactly `X.Y.Z` at
 * publish time, while resolving to the local workspace package during
 * development.
 *
 * Non-workspace specs (e.g. caret ranges from npm, catalog entries) are
 * intentionally left alone; only `workspace:` specifiers are rewritten.
 * Non-`@prisma-next/*` workspace deps (none today, but possible in
 * principle) are also left alone — the exact-pin discipline applies only
 * to the `@prisma-next/*` graph.
 */
export function rewriteWorkspaceDeps(packageJson: MutablePackageJson, version: string): void {
  for (const field of DEP_FIELDS) {
    const deps = packageJson[field];
    if (!deps) continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (!name.startsWith('@prisma-next/')) continue;
      if (typeof spec !== 'string' || !spec.startsWith('workspace:')) continue;
      deps[name] = `workspace:${version}`;
    }
  }
}
