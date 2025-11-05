import type { SqlContract } from '@prisma-next/sql-query/contract-types';
import type { TableDef, ModelDef } from '@prisma-next/sql-query/types';
import type { CodecTypes, ScalarToJs } from '@prisma-next/adapter-postgres/codec-types';

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
  {},
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

// Codec type map and scalar mapping imported from adapter - used for type inference in lanes
export type { CodecTypes, ScalarToJs };

export type User = Contract['models']['User'];
export type Post = Contract['models']['Post'];

