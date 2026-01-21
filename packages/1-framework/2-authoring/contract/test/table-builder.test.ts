import { describe, expect, it } from 'vitest';
import type { ColumnTypeDescriptor } from '../src/builder-state';
import { createTable } from '../src/table-builder';

const intColumn: ColumnTypeDescriptor = { codecId: 'test/int@1', nativeType: 'int4' };
const textColumn: ColumnTypeDescriptor = { codecId: 'test/text@1', nativeType: 'text' };
const vectorColumn: ColumnTypeDescriptor = {
  codecId: 'test/vector@1',
  nativeType: 'vector(1536)',
  typeParams: { length: 1536 },
};

describe('TableBuilder', () => {
  it('builds table state with columns', () => {
    const builder = createTable('user');
    const table = builder
      .column('id', { type: intColumn, nullable: false })
      .column('email', { type: textColumn, nullable: true })
      .primaryKey(['id'])
      .build();

    expect(table.name).toBe('user');
    expect(table.columns.id).toEqual({
      name: 'id',
      type: 'test/int@1',
      nullable: false,
      nativeType: 'int4',
    });
    expect(table.columns.email).toEqual({
      name: 'email',
      type: 'test/text@1',
      nullable: true,
      nativeType: 'text',
    });
    expect(table.primaryKey).toEqual(['id']);
  });

  it('stores unique constraints and emits them in build()', () => {
    const builder = createTable('user');
    const table = builder
      .column('email', { type: textColumn })
      .unique(['email'])
      .unique(['email'], 'user_email_unique')
      .build();

    expect(table.uniques).toHaveLength(2);
    expect(table.uniques[0]).toEqual({ columns: ['email'] });
    expect(table.uniques[1]).toEqual({ columns: ['email'], name: 'user_email_unique' });
  });

  it('stores indexes and emits them in build()', () => {
    const builder = createTable('user');
    const table = builder
      .column('email', { type: textColumn })
      .index(['email'])
      .index(['email'], 'user_email_idx')
      .build();

    expect(table.indexes).toHaveLength(2);
    expect(table.indexes[0]).toEqual({ columns: ['email'] });
    expect(table.indexes[1]).toEqual({ columns: ['email'], name: 'user_email_idx' });
  });

  it('stores foreign keys and emits them in build()', () => {
    const builder = createTable('post');
    const table = builder
      .column('userId', { type: intColumn })
      .foreignKey(['userId'], { table: 'user', columns: ['id'] })
      .foreignKey(['userId'], { table: 'user', columns: ['id'] }, 'post_userId_fkey')
      .build();

    expect(table.foreignKeys).toHaveLength(2);
    expect(table.foreignKeys[0]).toEqual({
      columns: ['userId'],
      references: { table: 'user', columns: ['id'] },
    });
    expect(table.foreignKeys[1]).toEqual({
      columns: ['userId'],
      references: { table: 'user', columns: ['id'] },
      name: 'post_userId_fkey',
    });
  });

  it('stores primary key name when provided', () => {
    const builder = createTable('user');
    const table = builder
      .column('id', { type: intColumn, nullable: false })
      .primaryKey(['id'], 'user_pkey')
      .build();

    expect(table.primaryKey).toEqual(['id']);
    expect(table.primaryKeyName).toBe('user_pkey');
  });

  it('builds table state without primary key but with default empty constraint arrays', () => {
    const builder = createTable('user');
    const table = builder.column('id', { type: intColumn, nullable: false }).build();

    expect(table.name).toBe('user');
    expect(table.columns.id).toEqual({
      name: 'id',
      type: 'test/int@1',
      nullable: false,
      nativeType: 'int4',
    });
    expect(table).not.toHaveProperty('primaryKey');
    expect(table.uniques).toEqual([]);
    expect(table.indexes).toEqual([]);
    expect(table.foreignKeys).toEqual([]);
  });

  it('defaults nullable to false when not provided', () => {
    const builder = createTable('user');
    const table = builder.column('id', { type: intColumn }).build();
    expect(table.columns.id.nullable).toBe(false);
  });

  it('stores column defaults in state', () => {
    const builder = createTable('user');
    const table = builder
      .column('id', {
        type: intColumn,
        default: { kind: 'function', name: 'autoincrement' },
      })
      .column('createdAt', {
        type: textColumn,
        default: { kind: 'function', name: 'uuid', params: ['v7'] },
      })
      .column('active', {
        type: textColumn,
        default: { kind: 'literal', value: true },
      })
      .build();

    expect(table.columns.id.default).toEqual({ kind: 'function', name: 'autoincrement' });
    expect(table.columns.createdAt.default).toEqual({
      kind: 'function',
      name: 'uuid',
      params: ['v7'],
    });
    expect(table.columns.active.default).toEqual({ kind: 'literal', value: true });
  });

  it('stores typeParams from descriptor', () => {
    const builder = createTable('document');
    const table = builder
      .column('id', { type: intColumn, nullable: false })
      .column('embedding', { type: vectorColumn, nullable: false })
      .primaryKey(['id'])
      .build();

    expect(table.columns.embedding).toEqual({
      name: 'embedding',
      type: 'test/vector@1',
      nullable: false,
      nativeType: 'vector(1536)',
      typeParams: { length: 1536 },
    });
  });

  it('stores typeParams from options', () => {
    const builder = createTable('document');
    const bareVectorColumn: ColumnTypeDescriptor = {
      codecId: 'test/vector@1',
      nativeType: 'vector',
    };
    const table = builder
      .column('id', { type: intColumn, nullable: false })
      .column('embedding', {
        type: bareVectorColumn,
        nullable: false,
        typeParams: { length: 768 },
      })
      .primaryKey(['id'])
      .build();

    expect(table.columns.embedding).toEqual({
      name: 'embedding',
      type: 'test/vector@1',
      nullable: false,
      nativeType: 'vector',
      typeParams: { length: 768 },
    });
  });

  it('options typeParams overrides descriptor typeParams', () => {
    const builder = createTable('document');
    const table = builder
      .column('id', { type: intColumn, nullable: false })
      .column('embedding', {
        type: vectorColumn,
        nullable: false,
        typeParams: { length: 384 },
      })
      .primaryKey(['id'])
      .build();

    expect(table.columns.embedding.typeParams).toEqual({ length: 384 });
  });

  it('omits typeParams when not provided', () => {
    const builder = createTable('user');
    const table = builder
      .column('id', { type: intColumn, nullable: false })
      .primaryKey(['id'])
      .build();

    expect(table.columns.id).not.toHaveProperty('typeParams');
  });
});
