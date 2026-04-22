// Re-exported so user-edited migration.ts files only need to depend on
// `@prisma-next/target-postgres/migration` to fill in planner-emitted
// `placeholder("…")` slots, instead of pulling in `@prisma-next/errors`
// directly. The planner emits an import from this same module.
export { placeholder } from '@prisma-next/errors/migration';
export {
  addColumn,
  alterColumnType,
  dropColumn,
  dropDefault,
  dropNotNull,
  setDefault,
  setNotNull,
} from '../core/migrations/operations/columns';
export {
  addForeignKey,
  addPrimaryKey,
  addUnique,
  dropConstraint,
} from '../core/migrations/operations/constraints';
export {
  type DataTransformClosure,
  type DataTransformOptions,
  dataTransform,
} from '../core/migrations/operations/data-transform';
export { createExtension, createSchema } from '../core/migrations/operations/dependencies';
export {
  addEnumValues,
  createEnumType,
  dropEnumType,
  renameType,
} from '../core/migrations/operations/enums';
export { createIndex, dropIndex } from '../core/migrations/operations/indexes';
export { rawSql } from '../core/migrations/operations/raw';
export { createTable, dropTable } from '../core/migrations/operations/tables';
