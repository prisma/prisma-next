// Contract type definitions for contract-with-relations.json

import type { SqlContract } from '@prisma-next/sql-target';
import type { TableDef, ModelDef } from '../../src/types';
import type { CodecTypes, ScalarToJs } from '@prisma-next/adapter-postgres/codec-types';

// Contract type representing the contract data structure with relations
export type Contract = SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: { readonly type: 'pg/int4@1'; nullable: false };
          readonly email: { readonly type: 'pg/text@1'; nullable: false };
          readonly createdAt: { readonly type: 'pg/timestamptz@1'; nullable: false };
        };
      };
      readonly post: {
        readonly columns: {
          readonly id: { readonly type: 'pg/int4@1'; nullable: false };
          readonly title: { readonly type: 'pg/text@1'; nullable: false };
          readonly userId: { readonly type: 'pg/int4@1'; nullable: false };
          readonly createdAt: { readonly type: 'pg/timestamptz@1'; nullable: false };
        };
      };
    };
  },
  {
    readonly User: ModelDef<'User'> & {
      readonly id: number;
      readonly email: string;
      readonly createdAt: string;
    };
    readonly Post: ModelDef<'Post'> & {
      readonly id: number;
      readonly title: string;
      readonly userId: number;
      readonly createdAt: string;
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
    readonly modelToTable: {
      readonly User: 'user';
      readonly Post: 'post';
    };
    readonly tableToModel: {
      readonly user: 'User';
      readonly post: 'Post';
    };
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
    readonly scalarToJs: ScalarToJs;
    readonly codecTypes: CodecTypes;
    readonly operationTypes: OperationTypes;
  }
> & {
  readonly storage: {
    readonly tables: {
      readonly user: TableDef<'user'> & {
        readonly id: number;
        readonly email: string;
        readonly createdAt: string;
      };
      readonly post: TableDef<'post'> & {
        readonly id: number;
        readonly title: string;
        readonly userId: number;
        readonly createdAt: string;
      };
    };
  };
};

// Codec type map and scalar mapping imported from adapter
export type { CodecTypes, ScalarToJs };

// Operation types (empty for now, can be extended by extension packs)
export type OperationTypes = Record<string, never>;

// Direct model exports for easy importing
export type User = Contract['models']['User'];
export type Post = Contract['models']['Post'];

