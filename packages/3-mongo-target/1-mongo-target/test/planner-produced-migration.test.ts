import type { MongoMigrationPlanOperation } from '@prisma-next/mongo-query-ast/control';
import { describe, expect, it } from 'vitest';
import { CreateIndexCall, DropIndexCall } from '../src/core/op-factory-call';
import { PlannerProducedMongoMigration } from '../src/core/planner-produced-migration';

const META = {
  from: 'sha256:00',
  to: 'sha256:01',
} as const;

describe('PlannerProducedMongoMigration', () => {
  it("identifies as the 'mongo' target", () => {
    const migration = new PlannerProducedMongoMigration([], META);

    expect(migration.targetId).toBe('mongo');
  });

  it('exposes describe() metadata as supplied', () => {
    const migration = new PlannerProducedMongoMigration([], META);

    expect(migration.describe()).toEqual(META);
  });

  it('derives origin/destination from describe() (round-trips through MigrationPlan surface)', () => {
    const migration = new PlannerProducedMongoMigration([], META);

    expect(migration.origin).toEqual({ storageHash: 'sha256:00' });
    expect(migration.destination).toEqual({ storageHash: 'sha256:01' });
  });

  it("treats a null 'from' as a null origin so runners do not match against an empty hash", () => {
    const migration = new PlannerProducedMongoMigration([], { from: null, to: 'sha256:01' });

    expect(migration.origin).toBeNull();
    expect(migration.destination).toEqual({ storageHash: 'sha256:01' });
  });

  it('renders the supplied OpFactoryCall list to runnable mongo operations via the operations getter', () => {
    const calls = [
      new CreateIndexCall('users', [{ field: 'email', direction: 1 }], { unique: true }),
      new DropIndexCall('users', [{ field: 'legacy', direction: 1 }]),
    ];
    const migration = new PlannerProducedMongoMigration(calls, META);

    const ops = migration.operations;

    expect(ops).toHaveLength(2);
    expect((ops[0] as MongoMigrationPlanOperation).execute[0]?.command.kind).toBe('createIndex');
    expect((ops[1] as MongoMigrationPlanOperation).execute[0]?.command.kind).toBe('dropIndex');
  });

  it('returns an empty operations list when constructed with no calls', () => {
    const migration = new PlannerProducedMongoMigration([], META);

    expect(migration.operations).toEqual([]);
  });

  it('renders authoring TypeScript that wires up MigrationCLI.run and derives describe() from contract JSON', () => {
    const calls = [new CreateIndexCall('users', [{ field: 'email', direction: 1 }])];
    const migration = new PlannerProducedMongoMigration(calls, META);

    const source = migration.renderTypeScript();

    // New shape: base derives describe() from the imported contract JSON, so the
    // scaffold carries `Migration<Start, End>` + the JSON/field imports and emits
    // no describe()/hash literals.
    expect(source).toContain('class M extends Migration<Start, End>');
    expect(source).toContain('override readonly startContractJson = startContract;');
    expect(source).toContain('override readonly endContractJson = endContract;');
    expect(source).toContain('override get operations()');
    expect(source).toContain('createIndex');
    expect(source).not.toContain('describe()');
    expect(source).not.toContain(META.from);
    expect(source).not.toContain(META.to);
    expect(source).toContain("import { MigrationCLI } from '@prisma-next/cli/migration-cli';");
    expect(source).toContain('MigrationCLI.run(import.meta.url, M);');
  });

  it('renders an empty-class stub when constructed with no calls', () => {
    const migration = new PlannerProducedMongoMigration([], META);

    const source = migration.renderTypeScript();

    expect(source).toContain('class M extends Migration<Start, End>');
    expect(source).toContain('override readonly endContractJson = endContract;');
    expect(source).toContain('override get operations()');
    expect(source).not.toContain('describe()');
  });

  it('renderTypeScript emits no describe() block (so no labels leak through it)', () => {
    const calls = [new CreateIndexCall('users', [{ field: 'email', direction: 1 }])];
    const migration = new PlannerProducedMongoMigration(calls, META);

    const source = migration.renderTypeScript();

    expect(source).toContain('class M extends Migration<Start, End>');
    expect(source).not.toContain('describe()');
    expect(source).not.toContain('labels:');
  });
});
