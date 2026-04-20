import type {
  MigrationOperationPolicy,
  MigrationPlan,
  MigrationRunnerExecutionChecks,
} from '@prisma-next/framework-components/control';
import type { MongoAdapter, MongoDriver } from '@prisma-next/mongo-lowering';
import type {
  AnyMongoDdlCommand,
  AnyMongoInspectionCommand,
  AnyMongoMigrationOperation,
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
  DropIndexCommand,
  MongoDdlCommandVisitor,
  MongoInspectionCommandVisitor,
} from '@prisma-next/mongo-query-ast/control';
import {
  AggregateCommand,
  MongoFieldFilter,
  MongoLimitStage,
  MongoMatchStage,
  type MongoQueryPlan,
  RawUpdateManyCommand,
} from '@prisma-next/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { createCollection, dataTransform } from '../src/core/migration-factories';
import { serializeMongoOps } from '../src/core/mongo-ops-serializer';
import {
  type MarkerOperations,
  MongoMigrationRunner,
  type MongoRunnerDependencies,
} from '../src/core/mongo-runner';

type Row = Record<string, unknown>;
// The wire-command union is exposed on `MongoAdapter['lower']`'s return type
// and on `MongoDriver.execute`'s parameter type. Re-deriving it here avoids a
// dependency on `@prisma-next/mongo-wire`, which `target-mongo` does not list
// as a direct devDependency.
type WireCommand = ReturnType<MongoAdapter['lower']>;

const ALL_POLICY: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

const NOOP_MARKER_OPS: MarkerOperations = {
  readMarker: async () => null,
  initMarker: async () => {},
  updateMarker: async () => true,
  writeLedgerEntry: async () => {},
};

class EventLog {
  readonly entries: string[] = [];
  record(entry: string): void {
    this.entries.push(entry);
  }
}

class StubMongoDriver implements MongoDriver {
  readonly executeCalls: WireCommand[] = [];
  private readonly responses: Row[][] = [];

  constructor(private readonly log?: EventLog) {}

  queueResponse(rows: Row[]): void {
    this.responses.push(rows);
  }

  execute<R>(wireCommand: WireCommand): AsyncIterable<R> {
    this.executeCalls.push(wireCommand);
    this.log?.record(`dml:${wireCommand.kind}:${wireCommand.collection}`);
    const rows = this.responses.shift() ?? [];
    return (async function* () {
      for (const row of rows) yield row as R;
    })();
  }

  async close(): Promise<void> {}
}

class StubMongoAdapter implements MongoAdapter {
  readonly loweredPlans: MongoQueryPlan[] = [];

  lower(plan: MongoQueryPlan): WireCommand {
    this.loweredPlans.push(plan);
    const kind = plan.command.kind;
    const wireKind = kind === 'aggregate' || kind === 'rawAggregate' ? 'aggregate' : 'updateMany';
    // The stub driver only reads `kind` and `collection`, so a minimal shape
    // is sufficient. The double-cast documents that this is a test-only
    // mock standing in for the full wire-command class hierarchy.
    return { kind: wireKind, collection: plan.collection } as unknown as WireCommand;
  }
}

class StubCommandExecutor implements MongoDdlCommandVisitor<Promise<void>> {
  readonly calls: AnyMongoDdlCommand[] = [];

  constructor(private readonly log?: EventLog) {}

  private async record(command: AnyMongoDdlCommand): Promise<void> {
    this.calls.push(command);
    this.log?.record(`ddl:${command.kind}:${command.collection}`);
  }

  createIndex(command: CreateIndexCommand): Promise<void> {
    return this.record(command);
  }
  dropIndex(command: DropIndexCommand): Promise<void> {
    return this.record(command);
  }
  createCollection(command: CreateCollectionCommand): Promise<void> {
    return this.record(command);
  }
  dropCollection(command: DropCollectionCommand): Promise<void> {
    return this.record(command);
  }
  collMod(command: CollModCommand): Promise<void> {
    return this.record(command);
  }
}

class StubInspectionExecutor implements MongoInspectionCommandVisitor<Promise<Row[]>> {
  readonly calls: AnyMongoInspectionCommand[] = [];

  async listIndexes(command: AnyMongoInspectionCommand): Promise<Row[]> {
    this.calls.push(command);
    return [];
  }
  async listCollections(command: AnyMongoInspectionCommand): Promise<Row[]> {
    this.calls.push(command);
    return [];
  }
}

const RUN_COLLECTION = 'users';
const PLAN_META = {
  target: 'mongo' as const,
  storageHash: 'sha256:test',
  lane: 'mongo-raw',
  paramDescriptors: [] as const,
};

function makeCheckPlan(): MongoQueryPlan {
  return {
    collection: RUN_COLLECTION,
    command: new AggregateCommand(RUN_COLLECTION, [
      new MongoMatchStage(MongoFieldFilter.eq('status', null)),
      new MongoLimitStage(1),
    ]),
    meta: { ...PLAN_META, lane: 'mongo-pipeline' },
  };
}

function makeWriteCheckPlan(): MongoQueryPlan {
  return {
    collection: RUN_COLLECTION,
    command: new RawUpdateManyCommand(
      RUN_COLLECTION,
      { status: { $exists: false } },
      { $set: { status: 'active' } },
    ),
    meta: PLAN_META,
  };
}

function makeRunPlan(): MongoQueryPlan {
  return {
    collection: RUN_COLLECTION,
    command: new RawUpdateManyCommand(
      RUN_COLLECTION,
      { status: { $exists: false } },
      { $set: { status: 'active' } },
    ),
    meta: PLAN_META,
  };
}

function serializedOperations(ops: readonly AnyMongoMigrationOperation[]): readonly unknown[] {
  return JSON.parse(serializeMongoOps(ops)) as readonly unknown[];
}

function makePlan(ops: readonly AnyMongoMigrationOperation[]): MigrationPlan {
  return {
    targetId: 'mongo',
    destination: { storageHash: 'sha256:dest' },
    // The runner's deserializer re-hydrates class instances from the JSON form,
    // so callers always hand it a pre-serialized operations list.
    operations: serializedOperations(ops) as unknown as MigrationPlan['operations'],
  };
}

interface Harness {
  readonly runner: MongoMigrationRunner;
  readonly driver: StubMongoDriver;
  readonly adapter: StubMongoAdapter;
  readonly commandExecutor: StubCommandExecutor;
  readonly inspectionExecutor: StubInspectionExecutor;
  readonly log: EventLog;
}

function makeHarness(): Harness {
  const log = new EventLog();
  const driver = new StubMongoDriver(log);
  const adapter = new StubMongoAdapter();
  const commandExecutor = new StubCommandExecutor(log);
  const inspectionExecutor = new StubInspectionExecutor();
  const deps: MongoRunnerDependencies = {
    commandExecutor,
    inspectionExecutor,
    adapter,
    driver,
    markerOps: NOOP_MARKER_OPS,
  };
  return {
    runner: new MongoMigrationRunner(deps),
    driver,
    adapter,
    commandExecutor,
    inspectionExecutor,
    log,
  };
}

async function execute(
  harness: Harness,
  ops: readonly AnyMongoMigrationOperation[],
  executionChecks?: MigrationRunnerExecutionChecks,
) {
  return harness.runner.execute({
    plan: makePlan(ops),
    destinationContract: { profileHash: 'sha256:dest' },
    policy: ALL_POLICY,
    frameworkComponents: [],
    ...(executionChecks ? { executionChecks } : {}),
  });
}

describe('MongoMigrationRunner.executeDataTransform', () => {
  it('runs the DML wire command once when there are no checks to gate it', async () => {
    const harness = makeHarness();
    const op = dataTransform('backfill-status', { run: () => makeRunPlan() });

    const result = await execute(harness, [op]);

    expect(result.assertOk()).toEqual({ operationsPlanned: 1, operationsExecuted: 1 });
    expect(harness.driver.executeCalls).toEqual([
      { kind: 'updateMany', collection: RUN_COLLECTION },
    ]);
    expect(harness.adapter.loweredPlans).toHaveLength(1);
    expect(harness.adapter.loweredPlans[0]?.command.kind).toBe('rawUpdateMany');
  });

  it('skips run when the postcheck probe reports the transform is already satisfied', async () => {
    const harness = makeHarness();
    const op = dataTransform('backfill-status', {
      check: { source: () => makeCheckPlan() },
      run: () => makeRunPlan(),
    });
    // Postcheck defaults to `expect: 'notExists'` — returning zero rows means
    // the transform is already satisfied, so the runner short-circuits.
    harness.driver.queueResponse([]);

    const result = await execute(harness, [op]);

    expect(result.assertOk()).toEqual({ operationsPlanned: 1, operationsExecuted: 0 });
    expect(harness.driver.executeCalls).toEqual([
      { kind: 'aggregate', collection: RUN_COLLECTION },
    ]);
  });

  it('fails with PRECHECK_FAILED and does not run the transform when the precheck is violated', async () => {
    const harness = makeHarness();
    const op = dataTransform('backfill-status', {
      check: { source: () => makeCheckPlan() },
      run: () => makeRunPlan(),
    });
    // Precheck expects `exists`; an empty response from the probe means the
    // required precondition is not met.
    harness.driver.queueResponse([]);

    const result = await execute(harness, [op], { idempotencyChecks: false });

    expect(result.assertNotOk()).toMatchObject({
      code: 'PRECHECK_FAILED',
      summary: `Operation ${op.id} failed during precheck`,
      meta: { operationId: op.id, name: op.name },
    });
    expect(harness.driver.executeCalls).toEqual([
      { kind: 'aggregate', collection: RUN_COLLECTION },
    ]);
  });

  it('fails with POSTCHECK_FAILED after the run when the postcheck is violated', async () => {
    const harness = makeHarness();
    const op = dataTransform('backfill-status', {
      check: { source: () => makeCheckPlan() },
      run: () => makeRunPlan(),
    });
    // 1) precheck probe (expect: 'exists') — rows present → passes.
    harness.driver.queueResponse([{ _id: 'u1' }]);
    // 2) run — consumes the driver but we don't yield rows.
    harness.driver.queueResponse([]);
    // 3) postcheck probe (expect: 'notExists') — rows present → fails.
    harness.driver.queueResponse([{ _id: 'u1' }]);

    const result = await execute(harness, [op], { idempotencyChecks: false });

    expect(result.assertNotOk()).toMatchObject({
      code: 'POSTCHECK_FAILED',
      summary: `Operation ${op.id} failed during postcheck`,
      meta: { operationId: op.id, name: op.name },
    });
    expect(harness.driver.executeCalls.map((c) => c.kind)).toEqual([
      'aggregate',
      'updateMany',
      'aggregate',
    ]);
  });

  it('rejects a check whose source is not an aggregate command before invoking driver.execute', async () => {
    const harness = makeHarness();
    const op = dataTransform('backfill-status', {
      check: { source: () => makeWriteCheckPlan() },
      run: () => makeRunPlan(),
    });

    let thrown: unknown;
    try {
      await execute(harness, [op], { idempotencyChecks: false });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({
      code: '3020',
      meta: {
        commandKind: 'rawUpdateMany',
        collection: RUN_COLLECTION,
      },
    });
    expect((thrown as Error).message).toContain('rawUpdateMany');
    expect(harness.driver.executeCalls).toEqual([]);
  });

  it('dispatches DDL ops through the command executor and data ops through the driver, in plan order', async () => {
    const harness = makeHarness();
    const ddlOp = createCollection('orders');
    const dataOp = dataTransform('seed-orders', { run: () => makeRunPlan() });

    const result = await execute(harness, [ddlOp, dataOp], {
      prechecks: false,
      postchecks: false,
      idempotencyChecks: false,
    });

    expect(result.assertOk()).toEqual({ operationsPlanned: 2, operationsExecuted: 2 });
    expect(harness.commandExecutor.calls).toHaveLength(1);
    expect(harness.commandExecutor.calls[0]).toMatchObject({
      kind: 'createCollection',
      collection: 'orders',
    });
    expect(harness.driver.executeCalls).toEqual([
      { kind: 'updateMany', collection: RUN_COLLECTION },
    ]);
    expect(harness.log.entries).toEqual([
      'ddl:createCollection:orders',
      `dml:updateMany:${RUN_COLLECTION}`,
    ]);
  });
});
