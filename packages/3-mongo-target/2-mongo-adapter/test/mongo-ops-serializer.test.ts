import {
  CreateIndexCommand,
  DropIndexCommand,
  ListIndexesCommand,
  MongoAndExpr,
  MongoExistsExpr,
  MongoFieldFilter,
  type MongoMigrationPlanOperation,
  MongoNotExpr,
  MongoOrExpr,
} from '@prisma-next/mongo-query-ast/control';
import { describe, expect, it } from 'vitest';
import { deserializeMongoOps, serializeMongoOps } from '../src/core/mongo-ops-serializer';

function makeCreateIndexOp(): MongoMigrationPlanOperation {
  return {
    id: 'index.users.create(email:1)',
    label: 'Create index on users (email ascending)',
    operationClass: 'additive',
    precheck: [
      {
        description: 'index does not already exist on users',
        source: new ListIndexesCommand('users'),
        filter: MongoFieldFilter.eq('key', { email: 1 }),
        expect: 'notExists',
      },
    ],
    execute: [
      {
        description: 'create index on users',
        command: new CreateIndexCommand('users', [{ field: 'email', direction: 1 }], {
          unique: true,
          name: 'email_1',
        }),
      },
    ],
    postcheck: [
      {
        description: 'index exists on users',
        source: new ListIndexesCommand('users'),
        filter: MongoAndExpr.of([
          MongoFieldFilter.eq('key', { email: 1 }),
          MongoFieldFilter.eq('unique', true),
        ]),
        expect: 'exists',
      },
    ],
  };
}

function makeDropIndexOp(): MongoMigrationPlanOperation {
  return {
    id: 'index.users.drop(email:1)',
    label: 'Drop index on users (email ascending)',
    operationClass: 'destructive',
    precheck: [
      {
        description: 'index exists on users',
        source: new ListIndexesCommand('users'),
        filter: MongoFieldFilter.eq('key', { email: 1 }),
        expect: 'exists',
      },
    ],
    execute: [
      {
        description: 'drop index on users',
        command: new DropIndexCommand('users', 'email_1'),
      },
    ],
    postcheck: [
      {
        description: 'index no longer exists on users',
        source: new ListIndexesCommand('users'),
        filter: MongoFieldFilter.eq('key', { email: 1 }),
        expect: 'notExists',
      },
    ],
  };
}

describe('serializeMongoOps / deserializeMongoOps', () => {
  it('round-trips a createIndex operation', () => {
    const original = [makeCreateIndexOp()];
    const serialized = serializeMongoOps(original);
    const deserialized = deserializeMongoOps(JSON.parse(serialized) as unknown[]);

    expect(deserialized).toHaveLength(1);
    const op = deserialized[0]!;
    expect(op.id).toBe('index.users.create(email:1)');
    expect(op.label).toBe('Create index on users (email ascending)');
    expect(op.operationClass).toBe('additive');

    expect(op.precheck).toHaveLength(1);
    expect(op.precheck[0]!.source.kind).toBe('listIndexes');
    expect(op.precheck[0]!.expect).toBe('notExists');

    expect(op.execute).toHaveLength(1);
    expect(op.execute[0]!.command.kind).toBe('createIndex');
    const cmd = op.execute[0]!.command as CreateIndexCommand;
    expect(cmd.collection).toBe('users');
    expect(cmd.keys).toEqual([{ field: 'email', direction: 1 }]);
    expect(cmd.unique).toBe(true);

    expect(op.postcheck).toHaveLength(1);
    expect(op.postcheck[0]!.filter.kind).toBe('and');
    expect(op.postcheck[0]!.expect).toBe('exists');
  });

  it('round-trips a dropIndex operation', () => {
    const original = [makeDropIndexOp()];
    const serialized = serializeMongoOps(original);
    const deserialized = deserializeMongoOps(JSON.parse(serialized) as unknown[]);

    expect(deserialized).toHaveLength(1);
    const op = deserialized[0]!;
    expect(op.id).toBe('index.users.drop(email:1)');
    expect(op.operationClass).toBe('destructive');

    const cmd = op.execute[0]!.command as DropIndexCommand;
    expect(cmd.kind).toBe('dropIndex');
    expect(cmd.collection).toBe('users');
    expect(cmd.name).toBe('email_1');
  });

  it('round-trips multiple operations', () => {
    const original = [makeCreateIndexOp(), makeDropIndexOp()];
    const serialized = serializeMongoOps(original);
    const deserialized = deserializeMongoOps(JSON.parse(serialized) as unknown[]);
    expect(deserialized).toHaveLength(2);
    expect(deserialized[0]!.id).toBe('index.users.create(email:1)');
    expect(deserialized[1]!.id).toBe('index.users.drop(email:1)');
  });

  it('round-trips $or filter expression', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [
        {
          description: 'test',
          source: new ListIndexesCommand('users'),
          filter: MongoOrExpr.of([
            MongoFieldFilter.eq('name', 'idx_a'),
            MongoFieldFilter.eq('name', 'idx_b'),
          ]),
          expect: 'notExists',
        },
      ],
      execute: [],
      postcheck: [],
    };
    const deserialized = deserializeMongoOps(JSON.parse(serializeMongoOps([op])) as unknown[]);
    expect(deserialized[0]!.precheck[0]!.filter.kind).toBe('or');
  });

  it('round-trips $not filter expression', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [
        {
          description: 'test',
          source: new ListIndexesCommand('users'),
          filter: MongoFieldFilter.eq('name', 'x').not(),
          expect: 'exists',
        },
      ],
      execute: [],
      postcheck: [],
    };
    const deserialized = deserializeMongoOps(JSON.parse(serializeMongoOps([op])) as unknown[]);
    expect(deserialized[0]!.precheck[0]!.filter.kind).toBe('not');
  });

  it('round-trips $exists filter expression', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [
        {
          description: 'test',
          source: new ListIndexesCommand('users'),
          filter: MongoExistsExpr.exists('unique'),
          expect: 'exists',
        },
      ],
      execute: [],
      postcheck: [],
    };
    const deserialized = deserializeMongoOps(JSON.parse(serializeMongoOps([op])) as unknown[]);
    const filter = deserialized[0]!.precheck[0]!.filter;
    expect(filter.kind).toBe('exists');
  });

  it('throws for unknown DDL command kind', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [],
        execute: [{ description: 'test', command: { kind: 'unknownCommand' } }],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Unknown DDL command kind/);
  });

  it('throws for unknown inspection command kind', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [
          {
            description: 'test',
            source: { kind: 'unknownInspection' },
            filter: { kind: 'field', field: 'x', op: '$eq', value: 1 },
            expect: 'exists',
          },
        ],
        execute: [],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Unknown inspection command kind/);
  });

  it('throws for unknown filter expression kind', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [
          {
            description: 'test',
            source: { kind: 'listIndexes', collection: 'users' },
            filter: { kind: 'unknownFilter' },
            expect: 'exists',
          },
        ],
        execute: [],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Unknown filter expression kind/);
  });

  it('preserves createIndex options through round-trip', () => {
    const pfe = { active: { $eq: true } };
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create index',
          command: new CreateIndexCommand('users', [{ field: 'status', direction: 1 }], {
            unique: true,
            sparse: true,
            expireAfterSeconds: 3600,
            partialFilterExpression: pfe,
            name: 'status_1',
          }),
        },
      ],
      postcheck: [],
    };
    const deserialized = deserializeMongoOps(JSON.parse(serializeMongoOps([op])) as unknown[]);
    const cmd = deserialized[0]!.execute[0]!.command as CreateIndexCommand;
    expect(cmd.unique).toBe(true);
    expect(cmd.sparse).toBe(true);
    expect(cmd.expireAfterSeconds).toBe(3600);
    expect(cmd.partialFilterExpression).toEqual(pfe);
    expect(cmd.name).toBe('status_1');
  });
});
