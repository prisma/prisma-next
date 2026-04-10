/**
 * Postgres migration operation descriptors.
 *
 * Re-exports all structural SQL descriptors from @prisma-next/family-sql
 * and adds data transform support with typed query builder callbacks.
 */

import type { Db, TableProxyContract } from '@prisma-next/sql-builder/types';
import type { SqlQueryPlan } from '@prisma-next/sql-relational-core/plan';

// Re-export structural descriptors from sql-family
export {
  type AddColumnDescriptor,
  type AddEnumValuesDescriptor,
  type AddForeignKeyDescriptor,
  type AddPrimaryKeyDescriptor,
  type AddUniqueDescriptor,
  type AlterColumnTypeDescriptor,
  addColumn,
  addEnumValues,
  addForeignKey,
  addPrimaryKey,
  addUnique,
  alterColumnType,
  type Buildable,
  type CreateDependencyDescriptor,
  type CreateEnumTypeDescriptor,
  type CreateIndexDescriptor,
  type CreateTableDescriptor,
  createDependency,
  createEnumType,
  createIndex,
  createTable,
  type DropColumnDescriptor,
  type DropConstraintDescriptor,
  type DropDefaultDescriptor,
  type DropEnumTypeDescriptor,
  type DropIndexDescriptor,
  type DropNotNullDescriptor,
  type DropTableDescriptor,
  dropColumn,
  dropConstraint,
  dropDefault,
  dropEnumType,
  dropIndex,
  dropNotNull,
  dropTable,
  type RenameTypeDescriptor,
  renameType,
  type SetDefaultDescriptor,
  type SetNotNullDescriptor,
  type SqlMigrationOpDescriptor,
  setDefault,
  setNotNull,
  TODO,
  type TodoMarker,
} from '@prisma-next/family-sql/operation-descriptors';

import {
  type Buildable,
  type DataTransformDescriptor,
  type SqlMigrationOpDescriptor,
  builders as structuralBuilders,
  TODO,
  type TodoMarker,
} from '@prisma-next/family-sql/operation-descriptors';

export type { DataTransformDescriptor };

// ============================================================================
// Typed data transform inputs (for createBuilders<Contract>())
// ============================================================================

/**
 * A single query plan input — callback, pre-built plan, or TODO placeholder.
 * @template TContract - The contract type for the Db client. Defaults to any
 *   (untyped). Use createBuilders<Contract>() to get typed callbacks.
 */
// biome-ignore lint/suspicious/noExplicitAny: default is untyped; createBuilders narrows this
export type QueryPlanInput<TContract extends TableProxyContract = any> =
  | ((db: Db<TContract>) => Buildable)
  | SqlQueryPlan
  | TodoMarker;

/** Run input — a callback returning one or many buildables, or a pre-built plan/TODO. */
// biome-ignore lint/suspicious/noExplicitAny: default is untyped; createBuilders narrows this
export type RunInput<TContract extends TableProxyContract = any> =
  | ((db: Db<TContract>) => Buildable | readonly Buildable[])
  | SqlQueryPlan
  | TodoMarker;

// ============================================================================
// Postgres descriptor union = SQL structural + data transforms
// ============================================================================

export type PostgresMigrationOpDescriptor = SqlMigrationOpDescriptor | DataTransformDescriptor;

// ============================================================================
// Data transform builder
// ============================================================================

function resolveInput(input: QueryPlanInput): QueryPlanInput {
  if (typeof input === 'symbol' || typeof input === 'function') return input;
  if ('build' in input && typeof (input as Buildable).build === 'function') {
    return (input as Buildable).build();
  }
  return input;
}

// biome-ignore lint/suspicious/noExplicitAny: default is untyped; createBuilders narrows this
export function dataTransform<TContract extends TableProxyContract = any>(
  name: string,
  options: {
    check: QueryPlanInput<TContract> | Buildable | boolean;
    run: RunInput<TContract> | Buildable;
  },
): DataTransformDescriptor {
  const check =
    typeof options.check === 'boolean'
      ? options.check
      : resolveInput(options.check as QueryPlanInput);

  const run: (symbol | object | ((...args: never[]) => unknown))[] = [];
  if (typeof options.run === 'function') {
    run.push(options.run);
  } else if (typeof options.run === 'symbol') {
    run.push(options.run);
  } else {
    run.push(resolveInput(options.run as QueryPlanInput));
  }
  return {
    kind: 'dataTransform' as const,
    name,
    source: 'migration.ts',
    check,
    run,
  };
}

/**
 * Creates typed migration builder functions parameterized by the contract type.
 * The dataTransform callback receives a fully typed Db<TContract> client.
 *
 * Usage:
 * ```typescript
 * import type { Contract } from "../../src/prisma/contract.d"
 * import { createBuilders } from "@prisma-next/target-postgres/migration-builders"
 *
 * const { addColumn, dataTransform, setNotNull } = createBuilders<Contract>()
 * ```
 */
export function createBuilders<TContract extends TableProxyContract>() {
  return {
    ...structuralBuilders,
    dataTransform: dataTransform<TContract>,
    TODO,
  };
}

/**
 * All builder functions keyed by descriptor kind.
 */
export const builders = {
  ...structuralBuilders,
  dataTransform,
} as const;
