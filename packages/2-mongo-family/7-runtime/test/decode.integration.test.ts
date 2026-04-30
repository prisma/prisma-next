import { isRuntimeError } from '@prisma-next/framework-components/runtime';
import { mongoCodec } from '@prisma-next/mongo-codec';
import { validateMongoContract } from '@prisma-next/mongo-contract';
import type { MongoResultShape } from '@prisma-next/mongo-query-ast/execution';
import {
  AggregateCommand,
  MongoFieldFilter,
  MongoMatchStage,
  RawAggregateCommand,
} from '@prisma-next/mongo-query-ast/execution';
import { contractModelToMongoResultShape } from '@prisma-next/mongo-query-builder';
import type { MongoValue } from '@prisma-next/mongo-value';
import { MongoParamRef } from '@prisma-next/mongo-value';
import { describe, expect, it } from 'vitest';
import { withMongod } from './setup';

const decodeFixtureContractJson = {
  targetFamily: 'mongo' as const,
  roots: { users: 'User' },
  storage: {
    collections: { users: {} },
    storageHash: 'decode-integration-test',
  },
  models: {
    User: {
      storage: { collection: 'users' },
      relations: {},
      fields: {
        _id: {
          type: { kind: 'scalar' as const, codecId: 'mongo/objectId@1' },
          nullable: false,
        },
        name: { type: { kind: 'scalar' as const, codecId: 'mongo/string@1' }, nullable: false },
        email: { type: { kind: 'scalar' as const, codecId: 'mongo/string@1' }, nullable: false },
        createdAt: {
          type: { kind: 'scalar' as const, codecId: 'mongo/date@1' },
          nullable: false,
        },
        embeddings: {
          type: { kind: 'scalar' as const, codecId: 'mongo/vector@1' },
          nullable: false,
          many: true,
        },
      },
    },
  },
};

describe('Mongo runtime decode integration', () => {
  it('typed read returns decoded _id, dates, and vector array', async () => {
    await withMongod(async (ctx) => {
      const { contract } = validateMongoContract(decodeFixtureContractJson);
      const model = contract.models['User'];
      if (!model) {
        throw new Error('fixture contract missing User model');
      }
      const collectionName = model.storage.collection ?? 'users';
      const createdAt = new Date('2024-01-15T12:00:00.000Z');
      const vec = [0.1, 0.2, 0.3];
      const insert = await ctx.client.db(ctx.dbName).collection(collectionName).insertOne({
        name: 'Test',
        email: 't@example.com',
        createdAt,
        embeddings: vec,
      });
      const command = new AggregateCommand(collectionName, [
        new MongoMatchStage(
          MongoFieldFilter.eq(
            '_id',
            MongoParamRef.of(insert.insertedId, {
              codecId: 'mongo/objectId@1',
            }) as unknown as MongoValue,
          ),
        ),
      ]);
      const resultShape = contractModelToMongoResultShape(model);
      const rows = await ctx.runtime
        .execute<{
          _id: string;
          name: string;
          email: string;
          createdAt: Date;
          embeddings: number[];
        }>({
          collection: collectionName,
          command,
          meta: ctx.stubMeta,
          resultShape,
        })
        .toArray();
      expect(rows).toHaveLength(1);
      const row = rows[0]!;
      expect(typeof row._id).toBe('string');
      expect(row._id).toBe(insert.insertedId.toHexString());
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.createdAt.getTime()).toBe(createdAt.getTime());
      expect(row.embeddings).toEqual(vec);
    });
  });

  it('decode failure surfaces RUNTIME.DECODE_FAILED with details and cause', async () => {
    await withMongod(async (ctx) => {
      const failing = mongoCodec({
        typeId: 'test/throws-on-decode@1',
        targetTypes: ['any'],
        encode: (v: string) => v,
        decode: () => {
          throw new Error('decode explosion');
        },
      });
      ctx.codecs.register(failing);

      const shape: MongoResultShape = {
        kind: 'document',
        fields: {
          x: { kind: 'leaf', codecId: 'test/throws-on-decode@1', nullable: false },
        },
      };
      const command = new AggregateCommand('items', [
        new MongoMatchStage(MongoFieldFilter.eq('x', 'wire')),
      ]);
      await ctx.client.db(ctx.dbName).collection('items').insertOne({ x: 'wire' });
      let err: unknown;
      try {
        for await (const _ of ctx.runtime.execute({
          collection: 'items',
          command,
          meta: ctx.stubMeta,
          resultShape: shape,
        })) {
          void _;
        }
      } catch (e) {
        err = e;
      }
      expect(isRuntimeError(err)).toBe(true);
      if (!isRuntimeError(err)) return;
      expect(err.code).toBe('RUNTIME.DECODE_FAILED');
      expect(err.details).toMatchObject({
        collection: 'items',
        path: 'x',
        codec: 'test/throws-on-decode@1',
      });
      expect(err.cause).toBeInstanceOf(Error);
    });
  });

  it('raw aggregate yields rows unchanged without resultShape', async () => {
    await withMongod(async (ctx) => {
      const oid = await ctx.client.db(ctx.dbName).collection('rawt').insertOne({ a: 1 });
      const command = new RawAggregateCommand('rawt', [{ $match: { _id: oid.insertedId } }]);
      const rows = await ctx.runtime
        .execute<{ _id: unknown }>({ collection: 'rawt', command, meta: ctx.stubMeta })
        .toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]!['_id']).not.toBe(oid.insertedId.toHexString());
      const ctorName = Object.getPrototypeOf(rows[0]!['_id']).constructor.name;
      expect(ctorName).toBe('ObjectId');
    });
  });

  it('unknown shape slot leaves driver value for that field intact', async () => {
    await withMongod(async (ctx) => {
      const nested = { city: 'Paris' };
      const insert = await ctx.client
        .db(ctx.dbName)
        .collection('opaque')
        .insertOne({ addr: nested });
      const shape: MongoResultShape = {
        kind: 'document',
        fields: {
          _id: { kind: 'leaf', codecId: 'mongo/objectId@1', nullable: false },
          addr: { kind: 'unknown' },
        },
      };
      const command = new AggregateCommand('opaque', [
        new MongoMatchStage(
          MongoFieldFilter.eq(
            '_id',
            MongoParamRef.of(insert.insertedId, {
              codecId: 'mongo/objectId@1',
            }) as unknown as MongoValue,
          ),
        ),
      ]);
      const rows = await ctx.runtime
        .execute<{ _id: string; addr: object }>({
          collection: 'opaque',
          command,
          meta: ctx.stubMeta,
          resultShape: shape,
        })
        .toArray();
      expect(rows[0]!.addr).toEqual(nested);
    });
  });
});
