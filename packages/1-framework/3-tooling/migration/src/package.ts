import type { MigrationPlanOperation } from '@prisma-next/framework-components/control';
import type { MigrationMetadata } from './metadata';

export type MigrationOps = readonly MigrationPlanOperation[];

/**
 * An on-disk migration directory (a "package") with its parsed metadata and
 * operations. Returned from `readMigrationPackage` / `readMigrationsDir` only
 * after the loader has verified the package's integrity (hash recomputation
 * against the stored `migrationHash`); holding a `MigrationPackage` value
 * therefore implies the package is internally consistent.
 */
export interface MigrationPackage {
  readonly dirName: string;
  readonly dirPath: string;
  readonly metadata: MigrationMetadata;
  readonly ops: MigrationOps;
}
