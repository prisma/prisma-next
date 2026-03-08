// Contract type definitions for contract-with-relations.json

import type { ContractWithTypeMaps, SqlContract, TypeMaps as TypeMapsType } from '@prisma-next/sql-contract/types';
import type { CodecTypes } from '@prisma-next/adapter-postgres/codec-types';

// Contract type representing the contract data structure with relations
export type Contract = ContractWithTypeMaps<SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            nullable: false;
          };
          readonly email: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            nullable: false;
          };
          readonly createdAt: {
            readonly nativeType: 'timestamptz';
            readonly codecId: 'pg/timestamptz@1';
            nullable: false;
          };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: ReadonlyArray<never>;
        readonly indexes: ReadonlyArray<never>;
        readonly foreignKeys: ReadonlyArray<never>;
      };
      readonly post: {
        readonly columns: {
          readonly id: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            nullable: false;
          };
          readonly title: {
            readonly nativeType: 'text';
            readonly codecId: 'pg/text@1';
            nullable: false;
          };
          readonly userId: {
            readonly nativeType: 'int4';
            readonly codecId: 'pg/int4@1';
            nullable: false;
          };
          readonly createdAt: {
            readonly nativeType: 'timestamptz';
            readonly codecId: 'pg/timestamptz@1';
            nullable: false;
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
    readonly Post: {
      readonly storage: { readonly table: 'post' };
      readonly fields: {
        readonly id: { readonly column: 'id' };
        readonly title: { readonly column: 'title' };
        readonly userId: { readonly column: 'userId' };
        readonly createdAt: { readonly column: 'createdAt' };
      };
      readonly relations: Record<string, never>;
    };
  },
  {
    readonly user: {
      readonly posts: {
        readonly to: 'Post';
        readonly cardinality: '1:N';
        readonly on: {
          readonly parentCols: readonly ['id'];
          readonly childCols: readonly ['userId'];
        };
      };
    };
    readonly post: {
      readonly user: {
        readonly to: 'User';
        readonly cardinality: 'N:1';
        readonly on: {
          readonly parentCols: readonly ['id'];
          readonly childCols: readonly ['userId'];
        };
      };
    };
  },
  {
    readonly modelToTable: { readonly User: 'user'; readonly Post: 'post' };
    readonly tableToModel: { readonly user: 'User'; readonly post: 'Post' };
    readonly fieldToColumn: {
      readonly User: {
        readonly id: 'id';
        readonly email: 'email';
        readonly createdAt: 'createdAt';
      };
      readonly Post: {
        readonly id: 'id';
        readonly title: 'title';
        readonly userId: 'userId';
        readonly createdAt: 'createdAt';
      };
    };
    readonly columnToField: {
      readonly user: {
        readonly id: 'id';
        readonly email: 'email';
        readonly createdAt: 'createdAt';
      };
      readonly post: {
        readonly id: 'id';
        readonly title: 'title';
        readonly userId: 'userId';
        readonly createdAt: 'createdAt';
      };
    };
  }
>, TypeMaps>;

export type { CodecTypes };

export type OperationTypes = Record<string, never>;

export type TypeMaps = TypeMapsType<CodecTypes, OperationTypes>;

// Direct model exports for easy importing
export type User = Contract['models']['User'];
export type Post = Contract['models']['Post'];
