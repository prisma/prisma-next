import { Migration } from '@prisma-next/migration-tools/migration';
import type { MongoMigrationPlanOperation } from '@prisma-next/mongo-query-ast/control';

/**
 * Family-owned base class for class-flow Mongo migrations.
 *
 * Provides the fixed `targetId = 'mongo'` so that user-authored migrations
 * and renderer-generated scaffolds (e.g. the output of
 * `renderCallsToTypeScript`) inherit it directly and don't have to re-declare
 * the abstract `targetId` member from `Migration`.
 */
export abstract class MongoMigration extends Migration<MongoMigrationPlanOperation> {
  readonly targetId = 'mongo' as const;
}
