// Re-exported so user-edited migration.ts files only need to depend on
// `@prisma-next/target-sqlite/migration` to fill in planner-emitted
// `placeholder("…")` slots, instead of pulling in `@prisma-next/errors`
// directly. The planner emits an import from this same module.
export { placeholder } from '@prisma-next/errors/migration';
export { addColumn, dropColumn } from '../core/migrations/operations/columns';
export {
  type DataTransformOptions,
  dataTransform,
} from '../core/migrations/operations/data-transform';
export { createIndex, dropIndex } from '../core/migrations/operations/indexes';
export { createTable, dropTable, recreateTable } from '../core/migrations/operations/tables';
// Target-owned base class for migrations. Aliased to `Migration` so
// user-edited migration.ts files (and the renderer's scaffold) read as
// `class M extends Migration { … }` without having to thread the
// target-details generic or redeclare `targetId`.
export { SqliteMigration as Migration } from '../core/migrations/sqlite-migration';
