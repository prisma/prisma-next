import { MongoDriverImpl } from '@prisma-next/driver-mongo';
import type {
  ControlFamilyInstance,
  MigrationPlan,
} from '@prisma-next/framework-components/control';
import type { MongoContract } from '@prisma-next/mongo-contract';
import { interpretPslDocumentToMongoContract } from '@prisma-next/mongo-contract-psl';
import type { AnyMongoMigrationOperation } from '@prisma-next/mongo-query-ast/control';
import { MongoSchemaIR } from '@prisma-next/mongo-schema-ir';
import { parsePslDocument } from '@prisma-next/psl-parser';
import {
  MongoMigrationPlanner,
  MongoMigrationRunner,
  serializeMongoOps,
} from '@prisma-next/target-mongo/control';
import { verifyMongoSchema } from '@prisma-next/target-mongo/schema-verify';
import { type Db, MongoClient, MongoServerError } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { introspectSchema } from '../src/core/introspect-schema';
import { createMongoControlDriver } from '../src/core/mongo-control-driver';
import { createMongoRunnerDeps } from '../src/core/runner-deps';

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
const dbName = 'runner_polymorphism_test';

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = new MongoClient(replSet.getUri());
  await client.connect();
  db = client.db(dbName);
});

afterAll(async () => {
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    await db.dropCollection(col['name'] as string);
  }
});

const mongoScalarTypeDescriptors: ReadonlyMap<string, string> = new Map([
  ['String', 'mongo/string@1'],
  ['Int', 'mongo/int32@1'],
  ['Boolean', 'mongo/bool@1'],
  ['DateTime', 'mongo/date@1'],
  ['ObjectId', 'mongo/objectId@1'],
  ['Float', 'mongo/double@1'],
]);

const polymorphicSchema = `
  model Task {
    id    ObjectId @id @map("_id")
    title String
    type  String

    @@discriminator(type)
    @@map("tasks")
    @@index([title])
  }

  model Bug {
    id       ObjectId @id @map("_id")
    severity String

    @@base(Task, "bug")
    @@unique([severity])
  }

  model Feature {
    id       ObjectId @id @map("_id")
    priority String

    @@base(Task, "feature")
    @@unique([priority])
  }
`;

function makeContractFromPsl(): MongoContract {
  const document = parsePslDocument({ schema: polymorphicSchema, sourceId: 'tasks.prisma' });
  const result = interpretPslDocumentToMongoContract({
    document,
    scalarTypeDescriptors: mongoScalarTypeDescriptors,
  });
  if (!result.ok) {
    throw new Error(
      `PSL interpretation failed: ${JSON.stringify(result.failure.diagnostics, null, 2)}`,
    );
  }
  // Same rationale as `makeContract` in `mongo-runner.schema-verify.integration.test.ts`:
  // the planner + runner consult the structural face of MongoContract here, and
  // the interpreter's Contract output is structurally identical for these
  // surfaces. The cast spares us from threading a full type-parameter chain
  // through a test that only cares about the migration path.
  return result.value as unknown as MongoContract;
}

function planForContract(
  contract: MongoContract,
  origin: MongoSchemaIR = new MongoSchemaIR([]),
  fromHash = '',
): MigrationPlan {
  const planner = new MongoMigrationPlanner();
  const result = planner.plan({
    contract,
    schema: origin,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    fromHash,
    frameworkComponents: [],
  });
  if (result.kind !== 'success') throw new Error('Planner failed unexpectedly');
  return result.plan;
}

function serializePlan(plan: MigrationPlan): MigrationPlan {
  const serialized = JSON.parse(serializeMongoOps(plan.operations as AnyMongoMigrationOperation[]));
  return {
    targetId: plan.targetId,
    operations: serialized,
    origin: plan.origin ?? null,
    destination: plan.destination,
  };
}

function fakeFamily(): ControlFamilyInstance<'mongo', MongoSchemaIR> {
  return {
    familyId: 'mongo' as const,
    introspect: async () => introspectSchema(db),
  } as unknown as ControlFamilyInstance<'mongo', MongoSchemaIR>;
}

function makeRunner() {
  return new MongoMigrationRunner(
    createMongoRunnerDeps(
      createMongoControlDriver(db, client),
      MongoDriverImpl.fromDb(db),
      fakeFamily(),
    ),
  );
}

async function applyPolymorphicMigration() {
  const contract = makeContractFromPsl();
  const plan = serializePlan(planForContract(contract));
  const runner = makeRunner();
  const result = await runner.execute({
    plan,
    destinationContract: contract,
    policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
    frameworkComponents: [],
  });
  return { contract, result };
}

describe('MongoMigrationRunner polymorphism (integration)', () => {
  it('plans + applies a polymorphic PSL contract and produces correctly-scoped partial indexes on the live DB', async () => {
    const { result } = await applyPolymorphicMigration();
    expect(result.ok).toBe(true);

    const liveIndexes = await db.collection('tasks').listIndexes().toArray();

    const titleIdx = liveIndexes.find((idx) => idx['key']?.['title'] === 1);
    expect(titleIdx).toBeDefined();
    expect(titleIdx?.['partialFilterExpression']).toBeUndefined();

    const severityIdx = liveIndexes.find((idx) => idx['key']?.['severity'] === 1);
    expect(severityIdx).toBeDefined();
    expect(severityIdx?.['unique']).toBe(true);
    expect(severityIdx?.['partialFilterExpression']).toEqual({ type: 'bug' });

    const priorityIdx = liveIndexes.find((idx) => idx['key']?.['priority'] === 1);
    expect(priorityIdx).toBeDefined();
    expect(priorityIdx?.['unique']).toBe(true);
    expect(priorityIdx?.['partialFilterExpression']).toEqual({ type: 'feature' });
  });

  it('enforces the partial unique index per variant', async () => {
    const { result } = await applyPolymorphicMigration();
    expect(result.ok).toBe(true);

    const tasks = db.collection('tasks');

    await tasks.insertOne({ title: 'login broken', type: 'bug', severity: 'critical' });
    await tasks.insertOne({ title: 'add dark mode', type: 'feature', priority: 'p1' });

    let duplicateBugError: unknown;
    try {
      await tasks.insertOne({ title: 'logout broken', type: 'bug', severity: 'critical' });
    } catch (err) {
      duplicateBugError = err;
    }
    expect(duplicateBugError).toBeInstanceOf(MongoServerError);
    expect((duplicateBugError as MongoServerError).code).toBe(11000);

    await tasks.insertOne({
      title: 'feature with same string as bug severity',
      type: 'feature',
      priority: 'critical',
    });

    let duplicateFeatureError: unknown;
    try {
      await tasks.insertOne({
        title: 'another feature',
        type: 'feature',
        priority: 'p1',
      });
    } catch (err) {
      duplicateFeatureError = err;
    }
    expect(duplicateFeatureError).toBeInstanceOf(MongoServerError);
    expect((duplicateFeatureError as MongoServerError).code).toBe(11000);
  });

  it('round-trips through introspection: verifyMongoSchema reports zero issues against the live DB', async () => {
    const { contract, result } = await applyPolymorphicMigration();
    expect(result.ok).toBe(true);

    const liveSchema = await introspectSchema(db);
    const verify = verifyMongoSchema({
      contract,
      schema: liveSchema,
      strict: true,
      frameworkComponents: [],
    });

    expect(verify.ok).toBe(true);
    expect(verify.schema.issues).toEqual([]);
  });
});
