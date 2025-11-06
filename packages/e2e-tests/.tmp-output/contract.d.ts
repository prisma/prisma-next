// Generated contract types
import type { CodecTypes as PgTypes } from '@prisma-next/adapter-postgres/codec-types';

import type {
  SqlContract,
  SqlStorage,
  SqlMappings,
  ModelDefinition,
} from '@prisma-next/sql-target';

export type CodecTypes = PgTypes;
export type LaneCodecTypes = CodecTypes;

export type Contract = SqlContract<
  {
    readonly tables: {
      readonly user: {
        columns: {
          readonly id: { readonly type: 'pg/int4@1'; readonly nullable: false };
          readonly email: { readonly type: 'pg/text@1'; readonly nullable: false };
        };
        primaryKey: { readonly columns: readonly ['id'] };
      };
    };
  },
  {
    readonly User: {
      storage: { readonly table: 'user' };
      fields: {
        readonly id: CodecTypes['pg/int4@1']['output'];
        readonly email: CodecTypes['pg/text@1']['output'];
      };
    };
  },
  Record<string, never>,
  {
    modelToTable: { readonly User: 'user' };
    tableToModel: { readonly user: 'User' };
    fieldToColumn: { readonly User: { readonly id: 'id'; readonly email: 'email' } };
    columnToField: { readonly user: { readonly id: 'id'; readonly email: 'email' } };
  }
>;

export type Tables = Contract['storage']['tables'];
export type Models = Contract['models'];
export type Relations = Contract['relations'];
