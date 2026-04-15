import { Migration } from '@prisma-next/migration-tools/migration';
import type { MongoMigrationPlanOperation } from '@prisma-next/mongo-query-ast/control';

export abstract class MongoMigration extends Migration<MongoMigrationPlanOperation> {}
