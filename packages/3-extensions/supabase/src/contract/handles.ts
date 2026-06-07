/**
 * Branded model handles for the Supabase contract space.
 *
 * Each handle is a `ContractModelBuilder` branded `spaceId: 'supabase'` with
 * its real namespace, table name, and columns — so `AuthUser.refs.id` is a
 * cross-space `TargetFieldRef` carrying `spaceId:'supabase'`, `namespaceId:'auth'`,
 * `tableName:'users'`.
 *
 * Columns mirror the shipped contract (`src/contract/contract.json`); the
 * handle↔contract consistency test (`test/contract-handles.test.ts`) asserts
 * they agree so any drift is caught at test time.
 */
import { ContractModelBuilder, field } from '@prisma-next/sql-contract-ts/contract-builder';

const pgText = { codecId: 'pg/text@1', nativeType: 'text' } as const;
const pgTimestamptz = { codecId: 'pg/timestamptz@1', nativeType: 'timestamptz' } as const;

export const AuthUser = new ContractModelBuilder(
  {
    modelName: 'User' as const,
    namespace: 'auth',
    fields: {
      id: field.column(pgText).id(),
      email: field.column(pgText),
      created_at: field.column(pgTimestamptz),
      updated_at: field.column(pgTimestamptz),
    },
    relations: {},
  },
  undefined,
  undefined,
  'supabase' as const,
).sql({ table: 'users' });

export const AuthIdentity = new ContractModelBuilder(
  {
    modelName: 'Identity' as const,
    namespace: 'auth',
    fields: {
      id: field.column(pgText).id(),
      user_id: field.column(pgText),
      provider: field.column(pgText),
      created_at: field.column(pgTimestamptz),
      updated_at: field.column(pgTimestamptz),
    },
    relations: {},
  },
  undefined,
  undefined,
  'supabase' as const,
).sql({ table: 'identities' });

export const StorageBucket = new ContractModelBuilder(
  {
    modelName: 'Bucket' as const,
    namespace: 'storage',
    fields: {
      id: field.column(pgText).id(),
      name: field.column(pgText),
      created_at: field.column(pgTimestamptz),
      updated_at: field.column(pgTimestamptz),
    },
    relations: {},
  },
  undefined,
  undefined,
  'supabase' as const,
).sql({ table: 'buckets' });

export const StorageObject = new ContractModelBuilder(
  {
    modelName: 'Object' as const,
    namespace: 'storage',
    fields: {
      id: field.column(pgText).id(),
      bucket_id: field.column(pgText),
      name: field.column(pgText),
      created_at: field.column(pgTimestamptz),
      updated_at: field.column(pgTimestamptz),
    },
    relations: {},
  },
  undefined,
  undefined,
  'supabase' as const,
).sql({ table: 'objects' });
