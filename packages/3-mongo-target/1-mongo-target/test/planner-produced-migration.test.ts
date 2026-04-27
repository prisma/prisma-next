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
    const meta = { ...META, kind: 'baseline' as const, labels: ['initial'] };
    const migration = new PlannerProducedMongoMigration([], meta);

    expect(migration.describe()).toEqual(meta);
  });

  it('derives origin/destination from describe() (round-trips through MigrationPlan surface)', () => {
    const migration = new PlannerProducedMongoMigration([], META);

    expect(migration.origin).toEqual({ storageHash: 'sha256:00' });
    expect(migration.destination).toEqual({ storageHash: 'sha256:01' });
  });

  it("treats an empty 'from' as a null origin so runners do not match against an empty hash", () => {
    const migration = new PlannerProducedMongoMigration([], { from: '', to: 'sha256:01' });

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

  it('renders authoring TypeScript that wires up MigrationCLI.run and embeds describe() metadata', () => {
    const calls = [new CreateIndexCall('users', [{ field: 'email', direction: 1 }])];
    const migration = new PlannerProducedMongoMigration(calls, META);

    const source = migration.renderTypeScript();

    expect(source).toContain('class M extends Migration');
    expect(source).toContain('override get operations()');
    expect(source).toContain('createIndex');
    expect(source).toContain(META.from);
    expect(source).toContain(META.to);
    expect(source).toContain("import { MigrationCLI } from '@prisma-next/cli/migration-cli';");
    expect(source).toContain('MigrationCLI.run(import.meta.url, M);');
  });

  it('renders an empty-class stub when constructed with no calls', () => {
    const migration = new PlannerProducedMongoMigration([], META);

    const source = migration.renderTypeScript();

    expect(source).toContain('class M extends Migration');
    expect(source).toContain('override get operations()');
    expect(source).toContain(META.from);
    expect(source).toContain(META.to);
  });

  it('passes optional describe() metadata (kind, labels) through to renderTypeScript', () => {
    const calls = [new CreateIndexCall('users', [{ field: 'email', direction: 1 }])];
    const migration = new PlannerProducedMongoMigration(calls, {
      ...META,
      kind: 'baseline',
      labels: ['initial', 'seed'],
    });

    const source = migration.renderTypeScript();

    expect(source).toContain('class M extends Migration');
    expect(source).toContain(META.from);
    expect(source).toContain(META.to);
    expect(source).toContain('kind: "baseline"');
    expect(source).toContain('labels: ["initial", "seed"]');
  });

  it('omits optional describe() metadata from renderTypeScript when not supplied', () => {
    const calls = [new CreateIndexCall('users', [{ field: 'email', direction: 1 }])];
    const migration = new PlannerProducedMongoMigration(calls, META);

    const source = migration.renderTypeScript();

    expect(source).not.toContain('kind:');
    expect(source).not.toContain('labels:');
  });
});
