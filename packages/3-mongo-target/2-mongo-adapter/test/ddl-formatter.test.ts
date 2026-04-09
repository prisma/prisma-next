import {
  CreateIndexCommand,
  DropIndexCommand,
  ListIndexesCommand,
  MongoFieldFilter,
  type MongoMigrationPlanOperation,
} from '@prisma-next/mongo-query-ast/control';
import { describe, expect, it } from 'vitest';
import { formatMongoOperations } from '../src/core/ddl-formatter';

describe('formatMongoOperations', () => {
  it('formats createIndex with unique option', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'index.users.create(email:1)',
      label: 'Create index',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create index',
          command: new CreateIndexCommand('users', [{ field: 'email', direction: 1 }], {
            unique: true,
            name: 'email_1',
          }),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result).toEqual([
      'db.users.createIndex({ "email": 1 }, { unique: true, name: "email_1" })',
    ]);
  });

  it('formats createIndex without options', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create index',
          command: new CreateIndexCommand('posts', [{ field: 'title', direction: 1 }]),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result).toEqual(['db.posts.createIndex({ "title": 1 })']);
  });

  it('formats dropIndex', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'destructive',
      precheck: [],
      execute: [
        {
          description: 'drop index',
          command: new DropIndexCommand('users', 'email_1'),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result).toEqual(['db.users.dropIndex("email_1")']);
  });

  it('formats compound index', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create compound index',
          command: new CreateIndexCommand(
            'users',
            [
              { field: 'email', direction: 1 },
              { field: 'tenantId', direction: -1 },
            ],
            { unique: true },
          ),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result).toEqual([
      'db.users.createIndex({ "email": 1, "tenantId": -1 }, { unique: true })',
    ]);
  });

  it('formats multiple operations', () => {
    const ops: MongoMigrationPlanOperation[] = [
      {
        id: 'op1',
        label: 'op1',
        operationClass: 'additive',
        precheck: [],
        execute: [
          {
            description: 'create',
            command: new CreateIndexCommand('users', [{ field: 'email', direction: 1 }]),
          },
        ],
        postcheck: [],
      },
      {
        id: 'op2',
        label: 'op2',
        operationClass: 'destructive',
        precheck: [],
        execute: [
          {
            description: 'drop',
            command: new DropIndexCommand('posts', 'title_1'),
          },
        ],
        postcheck: [],
      },
    ];
    const result = formatMongoOperations(ops);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('createIndex');
    expect(result[1]).toContain('dropIndex');
  });

  it('skips operations without execute steps', () => {
    const ops = [{ id: 'test', label: 'test', operationClass: 'additive' as const }];
    const result = formatMongoOperations(ops);
    expect(result).toEqual([]);
  });

  it('formats createIndex with sparse and TTL options', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create index',
          command: new CreateIndexCommand('sessions', [{ field: 'expiresAt', direction: 1 }], {
            sparse: true,
            expireAfterSeconds: 3600,
          }),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result).toEqual([
      'db.sessions.createIndex({ "expiresAt": 1 }, { sparse: true, expireAfterSeconds: 3600 })',
    ]);
  });
});
