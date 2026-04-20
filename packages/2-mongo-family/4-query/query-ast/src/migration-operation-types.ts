import type {
  MigrationOperationClass,
  MigrationPlanOperation,
} from '@prisma-next/framework-components/control';
import type { AnyMongoDdlCommand } from './ddl-commands';
import type { MongoFilterExpr } from './filter-expressions';
import type { AnyMongoInspectionCommand } from './inspection-commands';

export interface MongoMigrationCheck {
  readonly description: string;
  readonly source: AnyMongoInspectionCommand;
  readonly filter: MongoFilterExpr;
  readonly expect: 'exists' | 'notExists';
}

export interface MongoMigrationStep {
  readonly description: string;
  readonly command: AnyMongoDdlCommand;
}

export interface MongoMigrationPlanOperation extends MigrationPlanOperation {
  readonly precheck: readonly MongoMigrationCheck[];
  readonly execute: readonly MongoMigrationStep[];
  readonly postcheck: readonly MongoMigrationCheck[];
}

/**
 * Union of all Mongo migration operation kinds. The class-flow scaffolding
 * (e.g. `PlannerProducedMongoMigration`) parameterises `Migration` over this
 * union so that future operation kinds can extend it without changes to the
 * spine.
 */
export type AnyMongoMigrationOperation = MongoMigrationPlanOperation;

export type { MigrationOperationClass, MigrationPlanOperation };
