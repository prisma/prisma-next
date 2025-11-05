import type { SqlContract } from '@prisma-next/sql-query/contract-types';
import type { TableDef, ModelDef } from '@prisma-next/sql-query/types';
import type { CodecTypes, ScalarToJs } from '@prisma-next/adapter-postgres/codec-types';

export type Contract = SqlContract<
  {
    readonly tables: {
      readonly User: {
        readonly columns: {
          readonly id: { readonly type: 'pg/text@1'; nullable: false };
          readonly email: { readonly type: 'pg/text@1'; nullable: false };
          readonly name: { readonly type: 'pg/text@1'; nullable: false };
          readonly createdAt: { readonly type: 'pg/timestamptz@1'; nullable: false };
        };
      };
    };
  },
  {
    readonly User: ModelDef<'User'> & {
      readonly id: string;
      readonly email: string;
      readonly name: string;
      readonly createdAt: string;
    };
  },
  {},
  {
    readonly modelToTable: {
      readonly User: 'User';
    };
    readonly tableToModel: {
      readonly User: 'User';
    };
    readonly fieldToColumn: {
      readonly User: {
        readonly id: 'id';
        readonly email: 'email';
        readonly name: 'name';
        readonly createdAt: 'createdAt';
      };
    };
    readonly columnToField: {
      readonly User: {
        readonly id: 'id';
        readonly email: 'email';
        readonly name: 'name';
        readonly createdAt: 'createdAt';
      };
    };
    readonly scalarToJs: ScalarToJs;
  }
> & {
  readonly storage: {
    readonly tables: {
      readonly User: TableDef<'User'> & {
        readonly id: string;
        readonly email: string;
        readonly name: string;
        readonly createdAt: string;
      };
    };
  };
};

// Codec type map and scalar mapping imported from adapter - used for type inference in lanes
export type { CodecTypes, ScalarToJs };

export type User = Contract['models']['User'];

