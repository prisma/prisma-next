import type { ExtensionPackRef, TargetPackRef } from '@prisma-next/contract/framework-components';
import { describe, expect, it } from 'vitest';
import { defineContract } from '../src/contract-builder';
import type { CodecTypes } from './fixtures/contract.d';
import { columnDescriptor } from './helpers/column-descriptor';

const int4Column = columnDescriptor('pg/int4@1');

const postgresTargetPack: TargetPackRef<'sql', 'postgres'> = {
  kind: 'target',
  id: 'postgres',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

const pgvectorPack: ExtensionPackRef<'sql', 'postgres'> = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'postgres',
  version: '0.0.1',
};

const mysqlTargetPack: ExtensionPackRef<'sql', string> = {
  kind: 'extension',
  id: 'pgvector',
  familyId: 'sql',
  targetId: 'mysql',
  version: '0.0.1',
};

describe('contract builder methods', () => {
  it('throws when building without target', () => {
    const builder = defineContract<CodecTypes>();
    expect(() => builder.build()).toThrow('target is required');
  });

  it('sets target correctly from pack ref', () => {
    const contract = defineContract<CodecTypes>().target(postgresTargetPack).build();
    expect(contract.target).toBe('postgres');
  });

  it('sets capabilities correctly', () => {
    const capabilities = { feature: { enabled: true } };
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .capabilities(capabilities)
      .build();
    expect(contract.capabilities).toEqual(capabilities);
  });

  it('sets storageHash correctly', () => {
    const hash = 'sha256:custom-hash';
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .storageHash(hash)
      .build();
    expect(contract.storageHash).toBe(hash);
  });

  it('uses default storageHash when not provided', () => {
    const contract = defineContract<CodecTypes>().target(postgresTargetPack).build();
    expect(contract.storageHash).toBe('sha256:ts-builder-placeholder');
  });

  it('table callback can return undefined', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', () => undefined)
      .build();
    expect(contract.storage.tables.user).toBeDefined();
  });

  it('table callback can return different builder', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => {
        const builder = t.column('id', { type: int4Column });
        return builder;
      })
      .build();
    expect(contract.storage.tables.user.columns.id).toBeDefined();
  });

  it('model callback can return undefined', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .model('User', 'user', () => undefined)
      .build();
    expect(contract.models.User).toBeDefined();
  });

  it('model callback can return different builder', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .model('User', 'user', (m) => {
        const builder = m.field('id', 'id');
        return builder;
      })
      .build();
    expect(contract.models.User.fields.id).toBeDefined();
  });

  it('builds table without primary key', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }))
      .build();
    expect(contract.storage.tables.user.columns.id).toBeDefined();
    expect(contract.storage.tables.user['primaryKey']).toBeUndefined();
  });

  it('builds model with relations', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .table('post', (t) =>
        t
          .column('id', { type: int4Column })
          .column('userId', { type: int4Column })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) => m.field('id', 'id'))
      .model('Post', 'post', (m) =>
        m
          .field('id', 'id')
          .field('userId', 'userId')
          .relation('user', {
            toModel: 'User',
            toTable: 'user',
            cardinality: 'N:1',
            on: {
              parentTable: 'post',
              parentColumns: ['userId'],
              childTable: 'user',
              childColumns: ['id'],
            },
          }),
      )
      .build();
    expect((contract.models['Post'] as { relations?: unknown })['relations']).toBeDefined();
    expect(contract.relations.post).toBeDefined();
    expect(contract.relations.post?.user).toBeDefined();
  });

  it('builds contract with multiple tables and models', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .table('post', (t) =>
        t
          .column('id', { type: int4Column })
          .column('userId', { type: int4Column })
          .primaryKey(['id']),
      )
      .table('comment', (t) =>
        t
          .column('id', { type: int4Column })
          .column('postId', { type: int4Column })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) => m.field('id', 'id'))
      .model('Post', 'post', (m) => m.field('id', 'id').field('userId', 'userId'))
      .model('Comment', 'comment', (m) => m.field('id', 'id').field('postId', 'postId'))
      .build();
    expect(contract.storage.tables.user).toBeDefined();
    expect(contract.storage.tables.post).toBeDefined();
    expect(contract.storage.tables.comment).toBeDefined();
    expect(contract.models.User).toBeDefined();
    expect(contract.models.Post).toBeDefined();
    expect(contract.models.Comment).toBeDefined();
  });

  it('handles empty table state gracefully', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', () => undefined)
      .build();
    expect(contract.storage.tables).toBeDefined();
  });

  it('handles empty model state gracefully', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .model('User', 'user', () => undefined)
      .build();
    expect(contract.models).toBeDefined();
  });

  it('builds contract with all optional fields', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .storageHash('sha256:custom')
      .capabilities({ feature: { enabled: true } })
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .model('User', 'user', (m) => m.field('id', 'id'))
      .build();
    expect(contract.storageHash).toBe('sha256:custom');
    expect(contract.capabilities).toEqual({ feature: { enabled: true } });
  });

  it('adds storage types and typeRef columns', () => {
    const roleColumn = {
      codecId: 'pg/enum@1',
      nativeType: 'role',
      typeRef: 'Role',
    } as const;

    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .storageType('Role', {
        codecId: 'pg/enum@1',
        nativeType: 'role',
        typeParams: { values: ['USER', 'ADMIN'] },
      })
      .table('user', (t) => t.column('role', { type: roleColumn }).primaryKey(['role']))
      .build();

    expect(contract.storage.types).toEqual({
      Role: {
        codecId: 'pg/enum@1',
        nativeType: 'role',
        typeParams: { values: ['USER', 'ADMIN'] },
      },
    });
    expect(contract.storage.tables.user.columns.role.typeRef).toBe('Role');
  });

  it('adds execution defaults for generated columns', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) =>
        t
          .generated('id', {
            type: int4Column,
            generated: { kind: 'generator', id: 'uuidv4' },
          })
          .column('email', { type: columnDescriptor('pg/text@1') })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) => m.field('id', 'id').field('email', 'email'))
      .build();

    expect(contract.execution?.mutations.defaults).toEqual([
      {
        ref: { table: 'user', column: 'id' },
        onCreate: { kind: 'generator', id: 'uuidv4' },
      },
    ]);
  });

  it('sorts execution defaults by table and column', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('zebra', (t) =>
        t
          .generated('zId', {
            type: int4Column,
            generated: { kind: 'generator', id: 'ulid' },
          })
          .primaryKey(['zId']),
      )
      .table('alpha', (t) =>
        t
          .generated('bId', {
            type: int4Column,
            generated: { kind: 'generator', id: 'uuidv7' },
          })
          .generated('aId', {
            type: int4Column,
            generated: { kind: 'generator', id: 'cuid2' },
          })
          .primaryKey(['aId']),
      )
      .build();

    expect(contract.execution?.mutations.defaults.map((entry) => entry.ref)).toEqual([
      { table: 'alpha', column: 'aId' },
      { table: 'alpha', column: 'bId' },
      { table: 'zebra', column: 'zId' },
    ]);
  });
});

describe('extensionPacks', () => {
  it('requires target selection before enabling packs', () => {
    expect(() => defineContract<CodecTypes>().extensionPacks({ pgvector: pgvectorPack })).toThrow(
      'extensionPacks() requires target() to be called first',
    );
  });

  it('enables namespace entries for pack refs', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .extensionPacks({ pgvector: pgvectorPack })
      .build();

    expect(contract.extensionPacks).toBeDefined();
    expect(contract.extensionPacks?.['pgvector']).toEqual({});
  });

  it('rejects non-extension pack refs', () => {
    const invalidPack = postgresTargetPack as unknown as ExtensionPackRef<'sql', 'postgres'>;
    expect(() =>
      defineContract<CodecTypes>()
        .target(postgresTargetPack)
        .extensionPacks({ invalid: invalidPack }),
    ).toThrow('extensionPacks() only accepts extension pack refs');
  });

  it('rejects family mismatches', () => {
    const wrongFamilyPack = {
      ...pgvectorPack,
      familyId: 'document',
    } as unknown as ExtensionPackRef<'sql', 'postgres'>;

    expect(() =>
      defineContract<CodecTypes>()
        .target(postgresTargetPack)
        .extensionPacks({ pgvector: wrongFamilyPack }),
    ).toThrow('targets family "document" but this builder targets "sql"');
  });

  it('rejects target mismatches', () => {
    expect(() =>
      defineContract<CodecTypes>()
        .target(postgresTargetPack)
        .extensionPacks({ pgvector: mysqlTargetPack }),
    ).toThrow('builder target is "postgres"');
  });

  it('ignores undefined pack refs in extensionPacks map', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .extensionPacks({
        missing: undefined as unknown as ExtensionPackRef<'sql', 'postgres'>,
        pgvector: pgvectorPack,
      })
      .build();

    expect(contract.extensionPacks?.['pgvector']).toEqual({});
  });

  it('preserves pre-populated extension namespace entries', () => {
    const builder = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .extensionPacks({ pgvector: pgvectorPack });

    (
      builder as unknown as {
        state: { extensionPacks?: Record<string, unknown> };
      }
    ).state.extensionPacks = { pgvector: { enabled: true } };

    const contract = builder.build();
    expect(contract.extensionPacks?.['pgvector']).toEqual({ enabled: true });
  });
});

describe('builder branch guards', () => {
  it('ignores sparse model entries and falsy field mappings', () => {
    const builder = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .model('User', 'user', (m) => m.field('id', 'id'));

    const state = (
      builder as unknown as {
        state: {
          models: Record<string, { fields: Record<string, string> } | undefined>;
        };
      }
    ).state;
    state.models['Ghost'] = undefined;
    const userModel = state.models['User'];
    if (!userModel) {
      throw new Error('Expected user model state to exist');
    }
    userModel.fields['empty'] = '';

    const contract = builder.build();
    expect(contract.models.User.fields.id).toEqual({ column: 'id' });
    expect(contract.models.User.fields).not.toHaveProperty('empty');
  });

  it('skips undefined relation entries during relation map assembly', () => {
    const builder = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .table('post', (t) =>
        t
          .column('id', { type: int4Column })
          .column('userId', { type: int4Column })
          .primaryKey(['id']),
      )
      .model('User', 'user', (m) => m.field('id', 'id'))
      .model('Post', 'post', (m) =>
        m
          .field('id', 'id')
          .field('userId', 'userId')
          .relation('user', {
            toModel: 'User',
            toTable: 'user',
            cardinality: 'N:1',
            on: {
              parentTable: 'post',
              parentColumns: ['userId'],
              childTable: 'user',
              childColumns: ['id'],
            },
          }),
      );

    const state = (
      builder as unknown as {
        state: { models: Record<string, { relations: Record<string, unknown> } | undefined> };
      }
    ).state;
    const postModel = state.models['Post'];
    if (!postModel) {
      throw new Error('Expected post model state to exist');
    }
    postModel.relations = { user: undefined };

    const contract = builder.build();
    expect(contract.relations.post).toEqual({});
  });
});

describe('typeParams', () => {
  const testVectorColumn = columnDescriptor('pg/vector@1', 'vector(1536)');

  it('includes typeParams in storage column when present in descriptor', () => {
    const vectorWithParams = {
      ...testVectorColumn,
      typeParams: { length: 1536 },
    };

    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('document', (t) =>
        t
          .column('id', { type: int4Column, nullable: false })
          .column('embedding', { type: vectorWithParams, nullable: false })
          .primaryKey(['id']),
      )
      .build();

    expect(contract.storage.tables.document.columns.embedding).toMatchObject({
      nativeType: 'vector(1536)',
      codecId: 'pg/vector@1',
      nullable: false,
      typeParams: { length: 1536 },
    });
  });

  it('includes typeParams in storage column when passed via options', () => {
    const vectorDescriptorWithoutParams = columnDescriptor('pg/vector@1', 'vector');
    const columnOptionsWithParams = {
      type: vectorDescriptorWithoutParams,
      nullable: false,
      typeParams: { length: 768 },
    } as const;
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('document', (t) =>
        t
          .column('id', { type: int4Column, nullable: false })
          .column('embedding', columnOptionsWithParams)
          .primaryKey(['id']),
      )
      .build();

    expect(contract.storage.tables.document.columns.embedding).toMatchObject({
      nativeType: 'vector',
      codecId: 'pg/vector@1',
      nullable: false,
      typeParams: { length: 768 },
    });
  });

  it('omits typeParams when not provided', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) =>
        t.column('id', { type: int4Column, nullable: false }).primaryKey(['id']),
      )
      .build();

    expect(contract.storage.tables.user.columns.id).not.toHaveProperty('typeParams');
  });

  it('prefers typeParams from options over descriptor', () => {
    const vectorDescriptorWithParams = {
      ...columnDescriptor('pg/vector@1', 'vector(1536)'),
      typeParams: { length: 1536 },
    };
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('document', (t) =>
        t
          .column('id', { type: int4Column, nullable: false })
          .column('embedding', {
            type: vectorDescriptorWithParams,
            nullable: false,
            typeParams: { length: 768 },
          })
          .primaryKey(['id']),
      )
      .build();

    expect(contract.storage.tables.document.columns.embedding).toMatchObject({
      nativeType: 'vector(1536)',
      codecId: 'pg/vector@1',
      nullable: false,
      typeParams: { length: 768 },
    });
  });
});

describe('column default encoding', () => {
  const textColumn = columnDescriptor('pg/text@1');
  const bigintColumn = columnDescriptor('pg/int8@1');
  const timestampColumn = columnDescriptor('pg/timestamptz@1');

  it('encodes JSON-safe literal defaults', () => {
    const payload = { role: 'admin', tags: ['a', 'b'], active: true } as const;
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column })
          .column('meta', { type: textColumn, default: { kind: 'literal', value: payload } })
          .primaryKey(['id']),
      )
      .build();

    expect(contract.storage.tables.user.columns.meta.default).toEqual({
      kind: 'literal',
      value: payload,
    });
  });

  it('supports literal defaults on nullable columns', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('user', (t) =>
        t
          .column('id', { type: int4Column })
          .column('nickname', {
            type: textColumn,
            nullable: true,
            default: { kind: 'literal', value: 'guest' },
          })
          .primaryKey(['id']),
      )
      .build();

    expect(contract.storage.tables.user.columns.nickname.default).toEqual({
      kind: 'literal',
      value: 'guest',
    });
    expect(contract.storage.tables.user.columns.nickname.nullable).toBe(true);
  });

  it('encodes bigint literal defaults as tagged bigint', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('counter', (t) =>
        t
          .column('id', { type: int4Column })
          .column('value', { type: bigintColumn, default: { kind: 'literal', value: 42n } })
          .primaryKey(['id']),
      )
      .build();

    expect(contract.storage.tables.counter.columns.value.default).toEqual({
      kind: 'literal',
      value: { $type: 'bigint', value: '42' },
    });
  });

  it('encodes Date literal defaults as ISO strings', () => {
    const dateValue = new Date('2025-01-01T00:00:00.000Z');
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('event', (t) =>
        t
          .column('id', { type: int4Column })
          .column('startsAt', {
            type: timestampColumn,
            default: { kind: 'literal', value: dateValue },
          })
          .primaryKey(['id']),
      )
      .build();

    expect(contract.storage.tables.event.columns.startsAt.default).toEqual({
      kind: 'literal',
      value: '2025-01-01T00:00:00.000Z',
    });
  });

  it('wraps pre-tagged bigint objects in raw tag', () => {
    const tagged = { $type: 'bigint', value: '9007199254740993' } as const;
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('counter', (t) =>
        t
          .column('id', { type: int4Column })
          .column('value', { type: bigintColumn, default: { kind: 'literal', value: tagged } })
          .primaryKey(['id']),
      )
      .build();

    expect(contract.storage.tables.counter.columns.value.default).toEqual({
      kind: 'literal',
      value: { $type: 'raw', value: tagged },
    });
  });

  it('wraps JSON objects with $type key in raw tag', () => {
    const jsonbColumn = columnDescriptor('pg/jsonb@1');
    const jsonDefault = { $type: 'custom', data: [1, 2, 3] } as const;
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('event', (t) =>
        t
          .column('id', { type: int4Column })
          .column('meta', {
            type: jsonbColumn,
            default: { kind: 'literal', value: jsonDefault },
          })
          .primaryKey(['id']),
      )
      .build();

    expect(contract.storage.tables.event.columns.meta.default).toEqual({
      kind: 'literal',
      value: { $type: 'raw', value: jsonDefault },
    });
  });

  it('does not wrap JSON objects without $type key', () => {
    const jsonbColumn = columnDescriptor('pg/jsonb@1');
    const jsonDefault = { role: 'admin', tags: ['a', 'b'] } as const;
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('event', (t) =>
        t
          .column('id', { type: int4Column })
          .column('meta', {
            type: jsonbColumn,
            default: { kind: 'literal', value: jsonDefault },
          })
          .primaryKey(['id']),
      )
      .build();

    expect(contract.storage.tables.event.columns.meta.default).toEqual({
      kind: 'literal',
      value: jsonDefault,
    });
  });

  it('keeps function defaults', () => {
    const contract = defineContract<CodecTypes>()
      .target(postgresTargetPack)
      .table('post', (t) =>
        t
          .column('id', { type: int4Column })
          .column('createdAt', {
            type: timestampColumn,
            default: { kind: 'function', expression: 'now()' },
          })
          .primaryKey(['id']),
      )
      .build();

    expect(contract.storage.tables.post.columns.createdAt.default).toEqual({
      kind: 'function',
      expression: 'now()',
    });
  });

  it('throws for unsupported literal default values', () => {
    expect(() =>
      defineContract<CodecTypes>()
        .target(postgresTargetPack)
        .table('user', (t) =>
          t
            .column('id', { type: int4Column })
            .column('meta', {
              type: textColumn,
              default: { kind: 'literal', value: (() => 'nope') as unknown as never },
            })
            .primaryKey(['id']),
        )
        .build(),
    ).toThrow(/Unsupported column default literal value/);
  });
});
