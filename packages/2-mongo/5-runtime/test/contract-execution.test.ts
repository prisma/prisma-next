import { createMongoAdapter } from '@prisma-next/adapter-mongo';
import type { PlanMeta } from '@prisma-next/contract/types';
import { createMongoDriver } from '@prisma-next/driver-mongo';
import {
  type ExtractMongoCodecTypes,
  FindCommand,
  type MongoContract,
  type MongoContractWithTypeMaps,
  type MongoLoweringContext,
  type MongoQueryPlan,
  type MongoTypeMaps,
} from '@prisma-next/mongo-core';
import { ObjectId } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { describe, expect, it } from 'vitest';
import { createMongoRuntime } from '../src/mongo-runtime';
import type { Contract } from './fixtures/contract';
import contractJson from './fixtures/contract.json' with { type: 'json' };

type InferRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, MongoTypeMaps>,
  ModelName extends string & keyof TContract['models'],
> = {
  [FieldName in keyof TContract['models'][ModelName]['fields']]: TContract['models'][ModelName]['fields'][FieldName]['nullable'] extends true
    ?
        | ExtractMongoCodecTypes<TContract>[TContract['models'][ModelName]['fields'][FieldName]['codecId']]['output']
        | null
    : ExtractMongoCodecTypes<TContract>[TContract['models'][ModelName]['fields'][FieldName]['codecId']]['output'];
};

describe('contract-driven execution', () => {
  it('executes a find plan with row type inferred from contract', async () => {
    const replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });

    try {
      const connectionUri = replSet.getUri();
      const dbName = 'test';

      const { MongoClient } = await import('mongodb');
      const client = new MongoClient(connectionUri);
      await client.connect();

      const db = client.db(dbName);
      const usersCollection = db.collection('users');
      const userId = new ObjectId();
      await usersCollection.insertOne({
        _id: userId,
        name: 'Alice',
        email: 'alice@example.com',
        bio: null,
        createdAt: new Date('2024-01-15T10:00:00Z'),
      });

      const adapter = createMongoAdapter();
      const driver = await createMongoDriver(connectionUri, dbName);
      const loweringContext: MongoLoweringContext = {
        contract: contractJson as unknown as MongoContract,
      };
      const runtime = createMongoRuntime({ adapter, driver, loweringContext });

      type UserRow = InferRow<Contract, 'User'>;

      const findCommand = new FindCommand('users', {});
      const meta: PlanMeta = {
        target: 'mongo',
        storageHash: 'test-hash',
        lane: 'mongo',
        paramDescriptors: [],
      };
      const plan: MongoQueryPlan<UserRow> = { command: findCommand, meta };

      const result = runtime.execute(plan);
      const rows: UserRow[] = [];
      for await (const row of result) {
        rows.push(row);
      }

      expect(rows).toHaveLength(1);
      const user = rows[0]!;
      expect(user.name).toBe('Alice');
      expect(user.email).toBe('alice@example.com');
      expect(user.bio).toBeNull();
      expect(user.createdAt).toEqual(new Date('2024-01-15T10:00:00Z'));

      await runtime.close();
      await client.close();
    } finally {
      await replSet.stop();
    }
  });
});
