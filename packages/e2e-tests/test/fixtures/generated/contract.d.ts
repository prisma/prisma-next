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
      readonly post: {
        columns: {
          readonly id: { readonly type: 'pg/int4@1'; readonly nullable: false };
          readonly userId: { readonly type: 'pg/int4@1'; readonly nullable: false };
          readonly title: { readonly type: 'pg/text@1'; readonly nullable: false };
        };
        primaryKey: { readonly columns: readonly ['id'] };
      };
      readonly comment: {
        columns: {
          readonly id: { readonly type: 'pg/int4@1'; readonly nullable: false };
          readonly postId: { readonly type: 'pg/int4@1'; readonly nullable: false };
          readonly content: { readonly type: 'pg/text@1'; readonly nullable: false };
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
    readonly Post: {
      storage: { readonly table: 'post' };
      fields: {
        readonly id: CodecTypes['pg/int4@1']['output'];
        readonly userId: CodecTypes['pg/int4@1']['output'];
        readonly title: CodecTypes['pg/text@1']['output'];
      };
    };
    readonly Comment: {
      storage: { readonly table: 'comment' };
      fields: {
        readonly id: CodecTypes['pg/int4@1']['output'];
        readonly postId: CodecTypes['pg/int4@1']['output'];
        readonly content: CodecTypes['pg/text@1']['output'];
      };
    };
  },
  Record<string, never>,
  {
    modelToTable: { readonly User: 'user'; readonly Post: 'post'; readonly Comment: 'comment' };
    tableToModel: { readonly user: 'User'; readonly post: 'Post'; readonly comment: 'Comment' };
    fieldToColumn: {
      readonly User: { readonly id: 'id'; readonly email: 'email' };
      readonly Post: { readonly id: 'id'; readonly userId: 'userId'; readonly title: 'title' };
      readonly Comment: {
        readonly id: 'id';
        readonly postId: 'postId';
        readonly content: 'content';
      };
    };
    columnToField: {
      readonly user: { readonly id: 'id'; readonly email: 'email' };
      readonly post: { readonly id: 'id'; readonly userId: 'userId'; readonly title: 'title' };
      readonly comment: {
        readonly id: 'id';
        readonly postId: 'postId';
        readonly content: 'content';
      };
    };
  }
>;

export type Tables = Contract['storage']['tables'];
export type Models = Contract['models'];
export type Relations = Contract['relations'];
