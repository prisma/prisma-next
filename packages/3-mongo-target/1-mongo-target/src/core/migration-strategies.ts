import type {
  MongoIndexKey,
  MongoMigrationPlanOperation,
} from '@prisma-next/mongo-query-ast/control';
import { createCollection, createIndex } from './migration-factories';

export function validatedCollection(
  name: string,
  schema: Record<string, unknown>,
  indexes: ReadonlyArray<{ keys: MongoIndexKey[]; unique?: boolean }>,
): MongoMigrationPlanOperation[] {
  return [
    createCollection(name, {
      validator: { $jsonSchema: schema },
      validationLevel: 'strict',
      validationAction: 'error',
    }),
    ...indexes.map((idx) => createIndex(name, idx.keys, { unique: idx.unique })),
  ];
}
