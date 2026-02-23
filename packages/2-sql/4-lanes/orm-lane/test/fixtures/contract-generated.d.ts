import type { ExecutionHashBase, ProfileHashBase, StorageHashBase } from '@prisma-next/contract/types';
import type { SqlContract } from '@prisma-next/sql-contract/types';

type CodecTypes = {
  readonly 'pg/text@1': { readonly output: string };
};

export type StorageHash = StorageHashBase<'sha256:test-core'>;
export type ExecutionHash = ExecutionHashBase<'sha256:test-execution'>;
export type ProfileHash = ProfileHashBase<'sha256:test-profile'>;

export type GeneratedContract = SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            readonly nullable: false;
          };
          readonly email: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            readonly nullable: false;
          };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: ReadonlyArray<never>;
        readonly indexes: ReadonlyArray<never>;
        readonly foreignKeys: ReadonlyArray<never>;
      };
    };
  },
  {
    readonly User: {
      readonly storage: { readonly table: 'user' };
      readonly fields: {
        readonly id: { readonly column: 'id' };
        readonly email: { readonly column: 'email' };
      };
      readonly relations: Record<string, never>;
    };
  },
  {},
  {
    readonly modelToTable: { readonly User: 'user' };
    readonly tableToModel: { readonly user: 'User' };
    readonly fieldToColumn: {
      readonly User: {
        readonly id: 'id';
        readonly email: 'email';
      };
    };
    readonly columnToField: {
      readonly user: {
        readonly id: 'id';
        readonly email: 'email';
      };
    };
  },
  StorageHash,
  ExecutionHash,
  ProfileHash
> & {
  readonly '__@prisma-next/sql-contract/codecTypes@__': CodecTypes;
  readonly '__@prisma-next/sql-contract/operationTypes@__': OperationTypes;
};

export type { CodecTypes };

export type OperationTypes = Record<string, never>;

export type User = GeneratedContract['models']['User'];
