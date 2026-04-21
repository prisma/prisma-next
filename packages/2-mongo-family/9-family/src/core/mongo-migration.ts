import { Migration } from '@prisma-next/migration-tools/migration';
import type { AnyMongoMigrationOperation } from '@prisma-next/mongo-query-ast/control';

/**
 * Family-owned base class for class-flow Mongo migrations.
 *
 * Provides the fixed `targetId = 'mongo'` so that user-authored migrations
 * and renderer-generated scaffolds (e.g. the output of
 * `renderCallsToTypeScript`) inherit it directly and don't have to re-declare
 * the abstract `targetId` member from `Migration`.
 *
 * The operation type parameter is `AnyMongoMigrationOperation` — the union
 * of DDL-shaped `MongoMigrationPlanOperation` and `MongoDataTransformOperation` —
 * so subclasses can return a mix of schema operations (e.g. `createIndex`,
 * `setValidation`) and data-transform operations (e.g. `dataTransform`).
 * Mirrors the generic parameter used by `PlannerProducedMongoMigration`.
 */
export abstract class MongoMigration extends Migration<AnyMongoMigrationOperation> {
  readonly targetId = 'mongo' as const;
}
