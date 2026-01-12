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

  it('sets coreHash correctly', () => {
    const hash = 'sha256:custom-hash';
    const contract = defineContract<CodecTypes>().target(postgresTargetPack).coreHash(hash).build();
    expect(contract.coreHash).toBe(hash);
  });

  it('uses default coreHash when not provided', () => {
    const contract = defineContract<CodecTypes>().target(postgresTargetPack).build();
    expect(contract.coreHash).toBe('sha256:ts-builder-placeholder');
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
      .coreHash('sha256:custom')
      .capabilities({ feature: { enabled: true } })
      .table('user', (t) => t.column('id', { type: int4Column }).primaryKey(['id']))
      .model('User', 'user', (m) => m.field('id', 'id'))
      .build();
    expect(contract.coreHash).toBe('sha256:custom');
    expect(contract.capabilities).toEqual({ feature: { enabled: true } });
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
