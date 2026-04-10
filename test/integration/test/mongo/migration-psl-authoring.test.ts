import {
  contractToMongoSchemaIR,
  MongoMigrationPlanner,
  MongoMigrationRunner,
  serializeMongoOps,
} from '@prisma-next/adapter-mongo/control';
import mongoControlDriver from '@prisma-next/driver-mongo/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import {
  createMongoScalarTypeDescriptors,
  interpretPslDocumentToMongoContract,
} from '@prisma-next/mongo-contract-psl';
import type { MongoMigrationPlanOperation } from '@prisma-next/mongo-query-ast/control';
import { parsePslDocument } from '@prisma-next/psl-parser';
import { timeouts } from '@prisma-next/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const ALL_POLICY = {
  allowedOperationClasses: ['additive', 'widening', 'destructive'] as const,
};

function pslToContract(schema: string): MongoContract {
  const document = parsePslDocument({ schema, sourceId: 'test.prisma' });
  const result = interpretPslDocumentToMongoContract({
    document,
    scalarTypeDescriptors: createMongoScalarTypeDescriptors(),
  });
  if (!result.ok) {
    throw new Error(`PSL interpretation failed: ${JSON.stringify(result)}`);
  }
  return result.value as MongoContract;
}

async function planAndApply(
  replSetUri: string,
  origin: MongoContract | null,
  destination: MongoContract,
): Promise<void> {
  const planner = new MongoMigrationPlanner();
  const schema = contractToMongoSchemaIR(origin);
  const result = planner.plan({
    contract: destination,
    schema,
    policy: ALL_POLICY,
    frameworkComponents: [],
  });
  if (result.kind !== 'success') {
    throw new Error(`Plan failed: ${JSON.stringify(result)}`);
  }
  const ops = result.plan.operations as readonly MongoMigrationPlanOperation[];
  if (ops.length === 0) return;

  const serialized = JSON.parse(serializeMongoOps(ops));
  const controlDriver = await mongoControlDriver.create(replSetUri);
  try {
    const runner = new MongoMigrationRunner();
    const runResult = await runner.execute({
      plan: {
        targetId: 'mongo',
        ...(origin ? { origin: { storageHash: origin.storage.storageHash } } : {}),
        destination: { storageHash: destination.storage.storageHash },
        operations: serialized,
      },
      driver: controlDriver,
      destinationContract: destination,
      policy: ALL_POLICY,
      frameworkComponents: [],
    });
    if (!runResult.ok) {
      throw new Error(`Apply failed: ${JSON.stringify(runResult)}`);
    }
  } finally {
    await controlDriver.close();
  }
}

describe('PSL authoring → migration E2E', { timeout: timeouts.spinUpDbServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  const dbName = 'psl_authoring_e2e_test';
  let replSetUri: string;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [{ launchTimeout: timeouts.spinUpDbServer, storageEngine: 'wiredTiger' }],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    db = client.db(dbName);
    replSetUri = replSet.getUri(dbName);
  }, timeouts.spinUpDbServer);

  beforeEach(async () => {
    await db.dropDatabase();
  });

  afterAll(async () => {
    try {
      await client?.close();
      await replSet?.stop();
    } catch {
      // ignore
    }
  }, timeouts.spinUpDbServer);

  it('PSL with @@index produces indexes on MongoDB', async () => {
    const contract = pslToContract(`
      model User {
        id    ObjectId @id @map("_id")
        email String
        name  String
        @@index([email])
        @@unique([name])
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('user').listIndexes().toArray();
    const emailIdx = indexes.find((idx) => idx['key']?.['email'] === 1);
    expect(emailIdx).toBeDefined();

    const nameIdx = indexes.find((idx) => idx['key']?.['name'] === 1);
    expect(nameIdx).toBeDefined();
    expect(nameIdx!['unique']).toBe(true);
  });

  it('PSL with @unique on field produces single-field unique index', async () => {
    const contract = pslToContract(`
      model User {
        id    ObjectId @id @map("_id")
        email String   @unique
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('user').listIndexes().toArray();
    const emailIdx = indexes.find((idx) => idx['key']?.['email'] === 1);
    expect(emailIdx).toBeDefined();
    expect(emailIdx!['unique']).toBe(true);
  });

  it('PSL with model fields produces $jsonSchema validator on MongoDB', async () => {
    const contract = pslToContract(`
      model User {
        id    ObjectId @id @map("_id")
        name  String
        age   Int
        bio   String?
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const colls = await db.listCollections({ name: 'user' }).toArray();
    expect(colls).toHaveLength(1);
    const options = (colls[0] as Record<string, unknown>)['options'] as
      | Record<string, unknown>
      | undefined;
    expect(options?.['validator']).toBeDefined();
    const validator = options!['validator'] as Record<string, unknown>;
    const schema = validator['$jsonSchema'] as Record<string, unknown>;
    expect(schema['bsonType']).toBe('object');

    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['name']?.['bsonType']).toBe('string');
    expect(props['age']?.['bsonType']).toBe('int');
    expect(props['bio']?.['bsonType']).toEqual(['null', 'string']);
  });

  it('PSL with @@index + model fields produces both indexes and validator', async () => {
    const contract = pslToContract(`
      model Post {
        id        ObjectId @id @map("_id")
        title     String
        createdAt DateTime
        @@index([createdAt])
      }
    `);

    const storage = contract.storage as unknown as Record<
      string,
      Record<string, Record<string, unknown>>
    >;
    const postColl = storage['collections']?.['post'];
    expect(postColl?.['indexes']).toBeDefined();
    expect(postColl?.['validator']).toBeDefined();

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('post').listIndexes().toArray();
    const createdAtIdx = indexes.find((idx) => idx['key']?.['createdAt'] === 1);
    expect(createdAtIdx).toBeDefined();

    const colls = await db.listCollections({ name: 'post' }).toArray();
    const options = (colls[0] as Record<string, unknown>)['options'] as
      | Record<string, unknown>
      | undefined;
    expect(options?.['validator']).toBeDefined();
  });

  it('PSL with @map respects mapped names in indexes and validators', async () => {
    const contract = pslToContract(`
      model User {
        id        ObjectId @id @map("_id")
        firstName String   @map("first_name")
        @@index([firstName])
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const indexes = await db.collection('user').listIndexes().toArray();
    const idx = indexes.find((i) => i['key']?.['first_name'] === 1);
    expect(idx).toBeDefined();

    const colls = await db.listCollections({ name: 'user' }).toArray();
    const mapUserInfo = colls[0] as Record<string, unknown>;
    const mapUserOpts = mapUserInfo['options'] as Record<string, unknown> | undefined;
    const validator = mapUserOpts?.['validator'] as Record<string, unknown> | undefined;
    const schema = validator!['$jsonSchema'] as Record<string, unknown>;
    const props = schema['properties'] as Record<string, unknown>;
    expect(props['first_name']).toBeDefined();
    expect(props['firstName']).toBeUndefined();
  });

  it('PSL with value objects produces nested $jsonSchema', async () => {
    const contract = pslToContract(`
      type Address {
        street String
        city   String
      }

      model User {
        id      ObjectId @id @map("_id")
        address Address
      }
    `);

    await planAndApply(replSetUri, null, contract);

    const colls = await db.listCollections({ name: 'user' }).toArray();
    const voUserInfo = colls[0] as Record<string, unknown>;
    const voUserOpts = voUserInfo['options'] as Record<string, unknown> | undefined;
    const validator = voUserOpts?.['validator'] as Record<string, unknown> | undefined;
    const schema = validator!['$jsonSchema'] as Record<string, unknown>;
    const props = schema['properties'] as Record<string, Record<string, unknown>>;
    expect(props['address']?.['bsonType']).toBe('object');
    const addressProps = props['address']?.['properties'] as Record<string, unknown>;
    expect(addressProps['street']).toBeDefined();
    expect(addressProps['city']).toBeDefined();
  });
});
