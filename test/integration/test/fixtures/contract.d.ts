import type {
  Contract as ContractShape,
  ProfileHashBase,
  StorageHashBase,
} from '@prisma-next/contract/types';
import type {
  ContractWithTypeMaps,
  TypeMaps as TypeMapsType,
} from '@prisma-next/sql-contract/types';

type CodecTypes = {
  readonly 'pg/int4@1': { output: number };
  readonly 'pg/text@1': { output: string };
  readonly 'pg/timestamptz@1': { output: string };
};

export type OperationTypes = Record<string, never>;
export type QueryOperationTypes = Record<string, never>;
export type TypeMaps = TypeMapsType<CodecTypes, OperationTypes, QueryOperationTypes>;

type ContractBase = ContractShape<
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
    readonly storageHash: StorageHashBase<string>;
    readonly types: Record<string, never>;
  },
  {
    readonly User: {
      readonly storage: {
        readonly table: 'user';
        readonly fields: {
          readonly id: { readonly column: 'id' };
          readonly email: { readonly column: 'email' };
          readonly createdAt: { readonly column: 'createdAt' };
        };
      };
      readonly fields: {
        readonly id: { readonly codecId: 'pg/int4@1'; readonly nullable: false };
        readonly email: { readonly codecId: 'pg/text@1'; readonly nullable: false };
        readonly createdAt: { readonly codecId: 'pg/timestamptz@1'; readonly nullable: false };
      };
      readonly relations: Record<string, never>;
    };
  }
> & {
  readonly target: 'postgres';
  readonly targetFamily: 'sql';
  readonly profileHash: ProfileHashBase<string>;
  readonly meta: Record<string, never>;
  readonly roots: Record<string, string>;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly extensionPacks: {};
};

export type Contract = ContractWithTypeMaps<ContractBase, TypeMaps>;

export type { CodecTypes };

export type User = Contract['models']['User'];
