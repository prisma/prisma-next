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

  it('stores composite unique constraints in build()', () => {
    const builder = createTable('user');
    const table = builder
      .column('first_name', { type: textColumn })
      .column('last_name', { type: textColumn })
      .unique(['first_name', 'last_name'])
      .build();

    expect(table.uniques).toHaveLength(1);
    expect(table.uniques[0]).toEqual({ columns: ['first_name', 'last_name'] });
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
      .foreignKey(['userId'], { table: 'user', columns: ['id'] }, { name: 'post_userId_fkey' })
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

  it('stores foreign key with referential actions via options object', () => {
    const builder = createTable('post');
    const table = builder
      .column('userId', { type: intColumn })
      .foreignKey(
        ['userId'],
        { table: 'user', columns: ['id'] },
        {
          onDelete: 'cascade',
          onUpdate: 'noAction',
        },
      )
      .build();

    expect(table.foreignKeys).toHaveLength(1);
    expect(table.foreignKeys[0]).toEqual({
      columns: ['userId'],
      references: { table: 'user', columns: ['id'] },
      onDelete: 'cascade',
      onUpdate: 'noAction',
    });
  });

  it('stores foreign key with name and referential actions via options', () => {
    const builder = createTable('post');
    const table = builder
      .column('userId', { type: intColumn })
      .foreignKey(
        ['userId'],
        { table: 'user', columns: ['id'] },
        {
          name: 'post_userId_fkey',
          onDelete: 'setNull',
        },
      )
      .build();

    expect(table.foreignKeys).toHaveLength(1);
    expect(table.foreignKeys[0]).toEqual({
      columns: ['userId'],
      references: { table: 'user', columns: ['id'] },
      name: 'post_userId_fkey',
      onDelete: 'setNull',
    });
  });

  it('backward compat: string name still works for foreignKey()', () => {
    const table = createTable('post')
      .column('userId', { type: intColumn })
      .foreignKey(['userId'], { table: 'user', columns: ['id'] }, 'post_userId_fkey')
      .build();

    expect(table.foreignKeys[0]).toEqual({
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
        default: { kind: 'function', expression: 'autoincrement()' },
      })
      .column('createdAt', {
        type: textColumn,
        default: { kind: 'function', expression: 'gen_random_uuid()' },
      })
      .column('active', {
        type: textColumn,
        default: { kind: 'literal', value: 'true' },
      })
      .build();

    expect(table.columns.id.default).toEqual({ kind: 'function', expression: 'autoincrement()' });
    expect(table.columns.createdAt.default).toEqual({
      kind: 'function',
      expression: 'gen_random_uuid()',
    });
    expect(table.columns.active.default).toEqual({ kind: 'literal', value: 'true' });
  });

  it('stores execution defaults via generated()', () => {
    const builder = createTable('user');
    const table = builder
      .generated('id', {
        type: textColumn,
        generated: {
          kind: 'generator',
          id: 'uuidv4',
        },
      })
      .build();

    expect(table.columns.id.executionDefault).toEqual({ kind: 'generator', id: 'uuidv4' });
    expect(table.columns.id.nullable).toBe(false);
  });

  it('stores typeParams via generated()', () => {
    const vectorIdColumn: ColumnTypeDescriptor = {
      codecId: 'test/vector@1',
      nativeType: 'vector',
    };

    const builder = createTable('document');
    const table = builder
      .generated('id', {
        type: vectorIdColumn,
        typeParams: { length: 256 },
        generated: { kind: 'generator', id: 'uuidv4' },
      })
      .build();

    expect(table.columns.id.typeParams).toEqual({ length: 256 });
    expect(table.columns.id.nullable).toBe(false);
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

  describe('nullable/default mutual exclusivity', () => {
    it('allows nullable column without default', () => {
      const table = createTable('user')
        .column('email', { type: textColumn, nullable: true })
        .build();

      expect(table.columns.email.nullable).toBe(true);
      expect(table.columns.email).not.toHaveProperty('default');
    });

    it('allows non-nullable column with default', () => {
      const table = createTable('user')
        .column('createdAt', {
          type: textColumn,
          default: { kind: 'function', expression: 'now()' },
        })
        .build();

      expect(table.columns.createdAt.nullable).toBe(false);
      expect(table.columns.createdAt.default).toEqual({
        kind: 'function',
        expression: 'now()',
      });
    });

    it('allows non-nullable column without default', () => {
      const table = createTable('user').column('id', { type: intColumn, nullable: false }).build();

      expect(table.columns.id.nullable).toBe(false);
      expect(table.columns.id).not.toHaveProperty('default');
    });

    it('allows explicit nullable: false with default', () => {
      const table = createTable('user')
        .column('status', {
          type: textColumn,
          nullable: false,
          default: { kind: 'literal', value: 'active' },
        })
        .build();

      expect(table.columns.status.nullable).toBe(false);
      expect(table.columns.status.default).toEqual({
        kind: 'literal',
        value: 'active',
      });
    });

    it('allows nullable column with default', () => {
      const table = createTable('user')
        .column('bio', {
          type: textColumn,
          nullable: true,
          default: { kind: 'literal', value: 'foo' },
        })
        .build();

      expect(table.columns.bio.nullable).toBe(true);
      expect(table.columns.bio.default).toEqual({ kind: 'literal', value: 'foo' });
    });
  });
});
