/**
 * Placeholder for the vendored EQL Postgres install bundle.
 *
 * The real bundle (~170KB of inlined SQL) lives at
 * `reference/cipherstash/stack/packages/stack/src/prisma/core/eql-bundle.ts`
 * in the first-attempt repo (adjacent worktree); it gets copied into
 * this package in M2.c when the live-Postgres + live-EQL integration
 * tests come online and exercise AC-INSTALL2 / AC-INSTALL3.
 *
 * For M2.a (this round), AC-INSTALL1 verifies only the *shape* of the
 * `databaseDependencies.init` declaration; the placeholder SQL string
 * keeps the descriptor exercise-able without committing the large
 * vendored file ahead of the integration-test plumbing.
 */

export const EQL_INSTALL_SQL =
  '-- TODO M2.c: vendor EQL_INSTALL_SQL from reference/cipherstash/stack/packages/stack/src/prisma/core/eql-bundle.ts';
