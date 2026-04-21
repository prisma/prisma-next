/**
 * Visitor-based lowering from the class-flow IR (`PostgresOpFactoryCall[]`)
 * down to the runtime-op type (`SqlMigrationPlanOperation<PostgresPlanTargetDetails>[]`)
 * the planner already produces.
 *
 * Each visitor method delegates 1:1 to the matching Phase 0 pure factory in
 * `op-factories.ts`. A visitor is chosen deliberately — `renderOps` is
 * exhaustive over the `PostgresOpFactoryCall` union and we want the compiler
 * to enforce that exhaustiveness as the union grows. The TypeScript renderer,
 * which must also recurse into `MigrationTsExpression` children of
 * `DataTransformCall`, uses polymorphism instead (see `render-typescript.ts`).
 *
 * `DataTransformCall` is in the union for forward compatibility (Phase 2
 * issue-planner retarget) but the walk-schema planner never constructs one.
 * Hence the `dataTransform` visitor throws — Phase 2 replaces the stub with a
 * real lowering that handles both closure and `PlaceholderExpression` bodies.
 */

import type { SqlMigrationPlanOperation } from '@prisma-next/family-sql/control';
import {
  addColumn,
  addEnumValues,
  addForeignKey,
  addPrimaryKey,
  addUnique,
  alterColumnType,
  createEnumType,
  createIndex,
  createTable,
  dropColumn,
  dropConstraint,
  dropDefault,
  dropEnumType,
  dropIndex,
  dropNotNull,
  dropTable,
  renameType,
  setDefault,
  setNotNull,
} from './op-factories';
import type {
  AddColumnCall,
  AddEnumValuesCall,
  AddForeignKeyCall,
  AddPrimaryKeyCall,
  AddUniqueCall,
  AlterColumnTypeCall,
  CreateEnumTypeCall,
  CreateIndexCall,
  CreateTableCall,
  DataTransformCall,
  DropColumnCall,
  DropConstraintCall,
  DropDefaultCall,
  DropEnumTypeCall,
  DropIndexCall,
  DropNotNullCall,
  DropTableCall,
  PostgresOpFactoryCall,
  PostgresOpFactoryCallVisitor,
  RenameTypeCall,
  SetDefaultCall,
  SetNotNullCall,
} from './op-factory-call';
import type { PostgresPlanTargetDetails } from './planner-target-details';

type Op = SqlMigrationPlanOperation<PostgresPlanTargetDetails>;

const renderVisitor: PostgresOpFactoryCallVisitor<Op> = {
  createTable(call: CreateTableCall): Op {
    return createTable(call.schemaName, call.tableName, call.columns, call.primaryKey);
  },
  dropTable(call: DropTableCall): Op {
    return dropTable(call.schemaName, call.tableName);
  },
  addColumn(call: AddColumnCall): Op {
    return addColumn(call.schemaName, call.tableName, call.column);
  },
  dropColumn(call: DropColumnCall): Op {
    return dropColumn(call.schemaName, call.tableName, call.columnName);
  },
  alterColumnType(call: AlterColumnTypeCall): Op {
    return alterColumnType(call.schemaName, call.tableName, call.columnName, call.options);
  },
  setNotNull(call: SetNotNullCall): Op {
    return setNotNull(call.schemaName, call.tableName, call.columnName);
  },
  dropNotNull(call: DropNotNullCall): Op {
    return dropNotNull(call.schemaName, call.tableName, call.columnName);
  },
  setDefault(call: SetDefaultCall): Op {
    return setDefault(call.schemaName, call.tableName, call.columnName, call.defaultSql);
  },
  dropDefault(call: DropDefaultCall): Op {
    return dropDefault(call.schemaName, call.tableName, call.columnName);
  },
  addPrimaryKey(call: AddPrimaryKeyCall): Op {
    return addPrimaryKey(call.schemaName, call.tableName, call.constraintName, call.columns);
  },
  addForeignKey(call: AddForeignKeyCall): Op {
    return addForeignKey(call.schemaName, call.tableName, call.fk);
  },
  addUnique(call: AddUniqueCall): Op {
    return addUnique(call.schemaName, call.tableName, call.constraintName, call.columns);
  },
  createIndex(call: CreateIndexCall): Op {
    return createIndex(call.schemaName, call.tableName, call.indexName, call.columns);
  },
  dropIndex(call: DropIndexCall): Op {
    return dropIndex(call.schemaName, call.tableName, call.indexName);
  },
  dropConstraint(call: DropConstraintCall): Op {
    return dropConstraint(call.schemaName, call.tableName, call.constraintName);
  },
  createEnumType(call: CreateEnumTypeCall): Op {
    return createEnumType(call.schemaName, call.typeName, call.values);
  },
  addEnumValues(call: AddEnumValuesCall): Op {
    return addEnumValues(call.schemaName, call.typeName, call.nativeType, call.values);
  },
  dropEnumType(call: DropEnumTypeCall): Op {
    return dropEnumType(call.schemaName, call.typeName);
  },
  renameType(call: RenameTypeCall): Op {
    return renameType(call.schemaName, call.fromName, call.toName);
  },
  dataTransform(_call: DataTransformCall): Op {
    throw new Error(
      'renderOps: DataTransformCall lowering is Phase 2 territory — the walk-schema planner does not emit data transforms.',
    );
  },
};

export function renderOps(calls: readonly PostgresOpFactoryCall[]): Op[] {
  return calls.map((call) => call.accept(renderVisitor));
}
