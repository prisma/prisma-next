// Contract type definitions
// Example: This pattern allows multiple contracts (e.g., authDataContract.d.ts, salesDataContract.d.ts)
// without namespace collisions. Each contract can have its own namespace name.

import type { ContractWithTypeMaps, SqlContract, TypeMaps } from '@prisma-next/sql-contract/types';

// Stub codec types for testing (matches stub codecs in createStubAdapter)
export type CodecTypes = {
  readonly 'pg/int4@1': { readonly input: number; readonly output: number };
  readonly 'pg/text@1': { readonly input: string; readonly output: string };
  readonly 'pg/timestamptz@1': { readonly input: string; readonly output: string };
};

type ContractBase = SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            readonly nullable: false;
          };
          readonly email: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            readonly nullable: false;
          };
          readonly createdAt: {
            readonly nativeType: 'timestamptz';
            readonly codecId: 'pg/timestamptz@1';
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
        readonly createdAt: { readonly column: 'createdAt' };
      };
      readonly relations: Record<string, never>;
    };
  },
  Record<string, never>,
  {
    readonly modelToTable: { readonly User: 'user' };
    readonly tableToModel: { readonly user: 'User' };
    readonly fieldToColumn: {
      readonly User: {
        readonly id: 'id';
        readonly email: 'email';
        readonly createdAt: 'createdAt';
      };
    };
    readonly columnToField: {
      readonly user: {
        readonly id: 'id';
        readonly email: 'email';
        readonly createdAt: 'createdAt';
      };
    };
    readonly codecTypes: CodecTypes;
    readonly operationTypes: OperationTypes;
  }
>;

export type OperationTypes = Record<string, never>;
export type Contract = ContractWithTypeMaps<ContractBase, TypeMaps<CodecTypes, OperationTypes>>;
export type User = Contract['models']['User'];
