// Re-exported so a Postgres `migration.ts` only needs the single
// `@prisma-next/postgres/migration` import for its base class and the
// CLI entrypoint, mirroring how `placeholder` is surfaced here. The
// renderer emits the entrypoint call as
// `MigrationCLI.run(import.meta.url, M)`.
export { MigrationCLI } from '@prisma-next/cli/migration-cli';
// Re-exported so user-edited migration.ts files only need to depend on
// `@prisma-next/postgres/migration` to fill in planner-emitted
// `placeholder("…")` slots, instead of pulling in `@prisma-next/errors`
// directly. The planner emits an import from this same module.
export { placeholder } from '@prisma-next/errors/migration';
export {
  col,
  fn,
  foreignKey,
  lit,
  primaryKey,
  unique,
} from '@prisma-next/sql-relational-core/contract-free';
export {
  alterColumnType,
  dropColumn,
  dropDefault,
  dropNotNull,
  setDefault,
  setNotNull,
} from '../core/migrations/operations/columns';
export {
  addCheckConstraint,
  addForeignKey,
  addPrimaryKey,
  addUnique,
  dropCheckConstraint,
  dropConstraint,
} from '../core/migrations/operations/constraints';
export {
  type DataTransformClosure,
  type DataTransformOptions,
  dataTransform,
} from '../core/migrations/operations/data-transform';
export {
  createExtension,
  installExtension,
} from '../core/migrations/operations/dependencies';
export {
  addEnumValues,
  createEnumType,
  dropEnumType,
  renameType,
} from '../core/migrations/operations/enums';
export { createIndex, dropIndex } from '../core/migrations/operations/indexes';
export { rawSql } from '../core/migrations/operations/raw';
export { dropTable } from '../core/migrations/operations/tables';
// Target-owned base class for migrations. Aliased to `Migration` so
// user-edited migration.ts files (and the renderer's scaffold) read as
// `class M extends Migration { … }` without having to thread the
// target-details generic or redeclare `targetId`.
export { PostgresMigration as Migration } from '../core/migrations/postgres-migration';
