/**
 * Phase 4 transitional barrel for `@prisma-next/migration-tools/types`.
 *
 * The `types.ts` module historically held every public type for the package.
 * Phase 4 of TML-2264 splits it into one file per concept (`metadata.ts`,
 * `package.ts`, `graph.ts`) and renames the types. This barrel re-exports
 * the new types so existing imports of `./types` keep resolving for the
 * lifetime of one commit; Phase 4 T4.7 deletes this file.
 */
export { MigrationToolsError } from './errors';
export type { MigrationHints, MigrationMetadata } from './metadata';
export type { MigrationOps, MigrationPackage } from './package';
export type { MigrationChainEntry, MigrationGraph } from './graph';
