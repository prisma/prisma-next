import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { Adapter, LoweredStatement, SelectAst } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import type { AnyBinaryBuilder, AnyOrderBuilder } from '@prisma-next/sql-relational-core/types';
import { createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { OrmIncludeChildBuilderImpl } from '../src/orm-include-child';
import type { OrmBuilderOptions } from '../src/orm-types';

describe('orm-include-child', () => {
  const int4ColumnMeta: StorageColumn = {
    nativeType: 'int4',
    codecId: 'pg/int4@1',
    nullable: false,
  };

  const contract: SqlContract<SqlStorage> = validateContract<SqlContract<SqlStorage>>({
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storageHash: 'sha256:test',
    models: {
      Post: {
        storage: { table: 'post' },
        fields: {
          id: { column: 'id' },
          title: { column: 'title' },
        },
        relations: {},
      },
    },
    storage: {
      tables: {
        post: {
          columns: {
            id: int4ColumnMeta,
            title: {
              nativeType: 'text',
              codecId: 'pg/text@1',
              nullable: false,
            },
          },
          primaryKey: { columns: ['id'] },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      },
    },
    relations: {},
    mappings: {
      modelToTable: { Post: 'post' },
      tableToModel: { post: 'Post' },
      fieldToColumn: { Post: { id: 'id', title: 'title' } },
      columnToField: { post: { id: 'id', title: 'title' } },
      codecTypes: {},
      operationTypes: {},
    },
    meta: {},
    sources: {},
  });

  const adapter = {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return { values: () => [] };
      },
    },
    lower: () => ({
      profileId: 'stub-profile',
      body: Object.freeze({ sql: '', params: [] }),
    }),
  } as unknown as Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement>;
  const context = createTestContext(contract, adapter);
  const options: OrmBuilderOptions<SqlContract<SqlStorage>> = { context };

  describe('OrmIncludeChildBuilderImpl', () => {
    describe('getState', () => {
      it('returns empty object when all properties are undefined', () => {
        const builder = new OrmIncludeChildBuilderImpl<
          SqlContract<SqlStorage>,
          Record<string, never>,
          'Post'
        >(options, 'Post');

        const state = (
          builder as OrmIncludeChildBuilderImpl<
            SqlContract<SqlStorage>,
            Record<string, never>,
            'Post'
          >
        ).getState();

        expect(state).toEqual({});
      });

      it('returns state with only childWhere', () => {
        const builder = new OrmIncludeChildBuilderImpl<
          SqlContract<SqlStorage>,
          Record<string, never>,
          'Post'
        >(options, 'Post');
        const whereBuilder = builder.where((model) => {
          const m = model as { id: { eq: (p: unknown) => AnyBinaryBuilder } };
          return m.id.eq(param('postId'));
        });

        const state = (
          whereBuilder as OrmIncludeChildBuilderImpl<
            SqlContract<SqlStorage>,
            Record<string, never>,
            'Post'
          >
        ).getState();

        expect(state).toMatchObject({
          childWhere: expect.anything(),
        });
        expect(state.childOrderBy).toBeUndefined();
        expect(state.childLimit).toBeUndefined();
        expect(state.childProjection).toBeUndefined();
      });

      it('returns state with only childOrderBy', () => {
        const builder = new OrmIncludeChildBuilderImpl<
          SqlContract<SqlStorage>,
          Record<string, never>,
          'Post'
        >(options, 'Post');
        const orderByBuilder = builder.orderBy((model) => {
          const m = model as { id: { desc: () => AnyOrderBuilder } };
          return m.id.desc();
        });

        const state = (
          orderByBuilder as OrmIncludeChildBuilderImpl<
            SqlContract<SqlStorage>,
            Record<string, never>,
            'Post'
          >
        ).getState();

        expect(state).toMatchObject({
          childOrderBy: expect.anything(),
        });
        expect(state.childWhere).toBeUndefined();
        expect(state.childLimit).toBeUndefined();
        expect(state.childProjection).toBeUndefined();
      });

      it('returns state with only childLimit', () => {
        const builder = new OrmIncludeChildBuilderImpl<
          SqlContract<SqlStorage>,
          Record<string, never>,
          'Post'
        >(options, 'Post');
        const limitBuilder = builder.take(10);

        const state = (
          limitBuilder as OrmIncludeChildBuilderImpl<
            SqlContract<SqlStorage>,
            Record<string, never>,
            'Post'
          >
        ).getState();

        expect(state).toMatchObject({
          childLimit: 10,
        });
        expect(state.childWhere).toBeUndefined();
        expect(state.childOrderBy).toBeUndefined();
        expect(state.childProjection).toBeUndefined();
      });

      it('returns state with only childProjection', () => {
        const builder = new OrmIncludeChildBuilderImpl<
          SqlContract<SqlStorage>,
          Record<string, never>,
          'Post'
        >(options, 'Post');
        const selectBuilder = builder.select((model) => {
          const m = model as {
            id: import('@prisma-next/sql-relational-core/types').AnyColumnBuilder;
          };
          return { id: m.id };
        });

        const state = (
          selectBuilder as OrmIncludeChildBuilderImpl<
            SqlContract<SqlStorage>,
            Record<string, never>,
            'Post',
            unknown
          >
        ).getState();

        expect(state).toMatchObject({
          childProjection: expect.objectContaining({ id: expect.anything() }),
        });
        expect(state.childWhere).toBeUndefined();
        expect(state.childOrderBy).toBeUndefined();
        expect(state.childLimit).toBeUndefined();
      });

      it('returns state with childWhere and childOrderBy', () => {
        const builder = new OrmIncludeChildBuilderImpl<
          SqlContract<SqlStorage>,
          Record<string, never>,
          'Post'
        >(options, 'Post');
        const chainedBuilder = builder
          .where((model) => {
            const m = model as { id: { eq: (p: unknown) => AnyBinaryBuilder } };
            return m.id.eq(param('postId'));
          })
          .orderBy((model) => {
            const m = model as { id: { desc: () => AnyOrderBuilder } };
            return m.id.desc();
          });

        const state = (
          chainedBuilder as OrmIncludeChildBuilderImpl<
            SqlContract<SqlStorage>,
            Record<string, never>,
            'Post'
          >
        ).getState();

        expect(state).toMatchObject({
          childWhere: expect.anything(),
          childOrderBy: expect.anything(),
        });
        expect(state.childLimit).toBeUndefined();
        expect(state.childProjection).toBeUndefined();
      });

      it('returns state with all properties defined', () => {
        const builder = new OrmIncludeChildBuilderImpl<
          SqlContract<SqlStorage>,
          Record<string, never>,
          'Post'
        >(options, 'Post');
        const fullBuilder = builder
          .where((model) => {
            const m = model as { id: { eq: (p: unknown) => AnyBinaryBuilder } };
            return m.id.eq(param('postId'));
          })
          .orderBy((model) => {
            const m = model as { id: { desc: () => AnyOrderBuilder } };
            return m.id.desc();
          })
          .take(10)
          .select((model) => {
            const m = model as {
              id: import('@prisma-next/sql-relational-core/types').AnyColumnBuilder;
            };
            return { id: m.id };
          });

        const state = (
          fullBuilder as OrmIncludeChildBuilderImpl<
            SqlContract<SqlStorage>,
            Record<string, never>,
            'Post',
            unknown
          >
        ).getState();

        expect(state).toMatchObject({
          childWhere: expect.anything(),
          childOrderBy: expect.anything(),
          childLimit: 10,
          childProjection: expect.objectContaining({ id: expect.anything() }),
        });
      });
    });

    describe('_getModelAccessor error paths', () => {
      it('throws error when model not found in mappings', () => {
        const contractWithoutModel: SqlContract<SqlStorage> = {
          ...contract,
          mappings: {
            ...contract.mappings,
            modelToTable: {},
          },
        };
        const contextWithoutModel = createTestContext(contractWithoutModel, adapter);
        const optionsWithoutModel: OrmBuilderOptions<SqlContract<SqlStorage>> = {
          context: contextWithoutModel,
        };
        const builder = new OrmIncludeChildBuilderImpl<
          SqlContract<SqlStorage>,
          Record<string, never>,
          'Post'
        >(optionsWithoutModel, 'Post');

        expect(() => {
          builder.where((model) => {
            const m = model as { id: { eq: (p: unknown) => AnyBinaryBuilder } };
            return m.id.eq(param('postId'));
          });
        }).toThrow('Model Post not found in mappings');
      });

      it('throws error when table not found in schema', () => {
        const contractWithInvalidTable: SqlContract<SqlStorage> = {
          ...contract,
          mappings: {
            ...contract.mappings,
            modelToTable: { Post: 'nonexistent' },
          },
        };
        const contextWithInvalidTable = createTestContext(contractWithInvalidTable, adapter);
        const optionsWithInvalidTable: OrmBuilderOptions<SqlContract<SqlStorage>> = {
          context: contextWithInvalidTable,
        };
        const builder = new OrmIncludeChildBuilderImpl<
          SqlContract<SqlStorage>,
          Record<string, never>,
          'Post'
        >(optionsWithInvalidTable, 'Post');

        expect(() => {
          builder.where((model) => {
            const m = model as { id: { eq: (p: unknown) => AnyBinaryBuilder } };
            return m.id.eq(param('postId'));
          });
        }).toThrow('Table nonexistent not found in schema');
      });

      it('throws error when model does not have fields', () => {
        const contractWithoutFields: SqlContract<SqlStorage> = {
          ...contract,
          models: {
            Post: {
              storage: { table: 'post' },
              relations: {},
              // Omit fields property
            } as typeof contract.models.Post,
          },
        };
        const contextWithoutFields = createTestContext(contractWithoutFields, adapter);
        const optionsWithoutFields: OrmBuilderOptions<SqlContract<SqlStorage>> = {
          context: contextWithoutFields,
        };
        const builder = new OrmIncludeChildBuilderImpl<
          SqlContract<SqlStorage>,
          Record<string, never>,
          'Post'
        >(optionsWithoutFields, 'Post');

        expect(() => {
          builder.where((model) => {
            const m = model as { id: { eq: (p: unknown) => AnyBinaryBuilder } };
            return m.id.eq(param('postId'));
          });
        }).toThrow('Model Post does not have fields');
      });

      it('throws error when model is not an object', () => {
        const contractWithInvalidModel: SqlContract<SqlStorage> = {
          ...contract,
          models: {
            Post: null as unknown as typeof contract.models.Post,
          },
        };
        const contextWithInvalidModel = createTestContext(contractWithInvalidModel, adapter);
        const optionsWithInvalidModel: OrmBuilderOptions<SqlContract<SqlStorage>> = {
          context: contextWithInvalidModel,
        };
        const builder = new OrmIncludeChildBuilderImpl<
          SqlContract<SqlStorage>,
          Record<string, never>,
          'Post'
        >(optionsWithInvalidModel, 'Post');

        expect(() => {
          builder.where((model) => {
            const m = model as { id: { eq: (p: unknown) => AnyBinaryBuilder } };
            return m.id.eq(param('postId'));
          });
        }).toThrow('Model Post does not have fields');
      });
    });
  });
});
