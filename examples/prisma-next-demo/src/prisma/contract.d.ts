import type { SqlContract } from '@prisma-next/sql/contract-types';
import type { TableDef, ModelDef } from '@prisma-next/sql/types';

export type Contract = SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: { readonly type: 'int4'; nullable: false };
          readonly email: { readonly type: 'text'; nullable: false };
          readonly createdAt: { readonly type: 'timestamptz'; nullable: false };
        };
      };
      readonly post: {
        readonly columns: {
          readonly id: { readonly type: 'int4'; nullable: false };
          readonly title: { readonly type: 'text'; nullable: false };
          readonly userId: { readonly type: 'int4'; nullable: false };
          readonly createdAt: { readonly type: 'timestamptz'; nullable: false };
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

export type User = Contract['models']['User'];
export type Post = Contract['models']['Post'];

