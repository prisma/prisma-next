import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import { col, createSchema, createTable, lit, now } from '../../src/contract-free/ddl';
import { CreateSchemaAst, CreateTableAst } from '../../src/exports/ast';

describe('createSchema', () => {
  it('constructs a CreateSchemaAst from a name string', () => {
    const ast = createSchema('prisma_contract');
    expect(ast).toBeInstanceOf(CreateSchemaAst);
    expect(ast.kind).toBe('create-schema');
    expect(ast.name).toBe('prisma_contract');
  });

  it('defaults ifNotExists to false', () => {
    const ast = createSchema('s');
    expect(ast.ifNotExists).toBe(false);
  });

  it('sets ifNotExists when option is provided', () => {
    const ast = createSchema('prisma_contract', { ifNotExists: true });
    expect(ast.ifNotExists).toBe(true);
  });

  it('produces a frozen node', () => {
    const ast = createSchema('prisma_contract', { ifNotExists: true });
    expect(Object.isFrozen(ast)).toBe(true);
  });

  it('collectParamRefs returns empty array', () => {
    expect(createSchema('prisma_contract', { ifNotExists: true }).collectParamRefs()).toEqual([]);
  });
});

describe('createTable', () => {
  it('constructs a CreateTableAst from a qualified name string', () => {
    const ast = createTable('prisma_contract.marker', [], { ifNotExists: true });
    expect(ast).toBeInstanceOf(CreateTableAst);
    expect(ast.kind).toBe('create-table');
    expect(ast.table).toEqual({ schema: 'prisma_contract', name: 'marker' });
    expect(ast.ifNotExists).toBe(true);
  });

  it('constructs from a bare name string (no schema)', () => {
    const ast = createTable('_prisma_marker', []);
    expect(ast.table).toEqual({ name: '_prisma_marker' });
    expect(ast.table.schema).toBeUndefined();
  });

  it('accepts a table descriptor object', () => {
    const ast = createTable({ schema: 'prisma_contract', name: 'marker' }, [], {
      ifNotExists: true,
    });
    expect(ast.table).toEqual({ schema: 'prisma_contract', name: 'marker' });
  });

  it('defaults ifNotExists to false', () => {
    const ast = createTable('t', []);
    expect(ast.ifNotExists).toBe(false);
  });

  it('stores the provided columns', () => {
    const columns = [col('space', 'text', { primaryKey: true, notNull: true })];
    const ast = createTable('t', columns);
    expect(ast.columns).toHaveLength(1);
    expect(ast.columns[0]?.name).toBe('space');
  });

  it('produces a frozen node with no contract or codec dependency', () => {
    const ast = createTable('_prisma_marker', [], { ifNotExists: true });
    expect(Object.isFrozen(ast)).toBe(true);
    expect(ast.collectParamRefs()).toEqual([]);
  });
});

describe('col', () => {
  it('constructs a column descriptor with required fields', () => {
    const c = col('space', 'text');
    expect(c).toEqual({ name: 'space', type: 'text' });
  });

  it('includes primaryKey when provided', () => {
    const c = col('space', 'text', { primaryKey: true });
    expect(c.primaryKey).toBe(true);
  });

  it('includes notNull when provided', () => {
    const c = col('core_hash', 'text', { notNull: true });
    expect(c.notNull).toBe(true);
  });

  it('includes a literal default when provided', () => {
    const c = col('space', 'text', { default: lit(APP_SPACE_ID) });
    expect(c.default).toEqual({ kind: 'literal', value: APP_SPACE_ID });
  });

  it('includes a now() default when provided', () => {
    const c = col('updated_at', 'timestamptz', { default: now() });
    expect(c.default).toEqual({ kind: 'now' });
  });

  it('omits optional fields when not provided', () => {
    const c = col('notes', 'text');
    expect(c.primaryKey).toBeUndefined();
    expect(c.notNull).toBeUndefined();
    expect(c.default).toBeUndefined();
  });
});

describe('lit', () => {
  it('produces a literal ColumnDefault', () => {
    expect(lit('app')).toEqual({ kind: 'literal', value: 'app' });
  });

  it('accepts the APP_SPACE_ID default value', () => {
    expect(lit(APP_SPACE_ID)).toEqual({ kind: 'literal', value: 'app' });
  });
});

describe('now', () => {
  it('produces a now ColumnDefault', () => {
    expect(now()).toEqual({ kind: 'now' });
  });
});

describe('Postgres marker table via builder', () => {
  it('constructs the marker table AST matching the Postgres DDL shape', () => {
    const ast = createTable(
      'prisma_contract.marker',
      [
        col('space', 'text', {
          notNull: true,
          primaryKey: true,
          default: lit(APP_SPACE_ID),
        }),
        col('core_hash', 'text', { notNull: true }),
        col('profile_hash', 'text', { notNull: true }),
        col('contract_json', 'jsonb'),
        col('canonical_version', 'int'),
        col('updated_at', 'timestamptz', { notNull: true, default: now() }),
        col('app_tag', 'text'),
        col('meta', 'jsonb', { notNull: true, default: lit('{}') }),
        col('invariants', 'text-array', { notNull: true, default: lit('{}') }),
      ],
      { ifNotExists: true },
    );

    expect(ast.table).toEqual({ schema: 'prisma_contract', name: 'marker' });
    expect(ast.ifNotExists).toBe(true);
    expect(ast.columns).toHaveLength(9);
    expect(ast.columns[0]).toMatchObject({
      name: 'space',
      type: 'text',
      notNull: true,
      primaryKey: true,
      default: { kind: 'literal', value: 'app' },
    });
    expect(ast.columns[5]).toMatchObject({
      name: 'updated_at',
      type: 'timestamptz',
      notNull: true,
      default: { kind: 'now' },
    });
    expect(ast.columns[8]).toMatchObject({
      name: 'invariants',
      type: 'text-array',
      notNull: true,
      default: { kind: 'literal', value: '{}' },
    });
    expect(ast.collectParamRefs()).toEqual([]);
  });
});

describe('Postgres ledger table via builder', () => {
  it('constructs the ledger table AST matching the Postgres DDL shape', () => {
    const ast = createTable(
      'prisma_contract.ledger',
      [
        col('id', 'bigserial', { primaryKey: true }),
        col('created_at', 'timestamptz', { notNull: true, default: now() }),
        col('origin_core_hash', 'text'),
        col('origin_profile_hash', 'text'),
        col('destination_core_hash', 'text', { notNull: true }),
        col('destination_profile_hash', 'text'),
        col('contract_json_before', 'jsonb'),
        col('contract_json_after', 'jsonb'),
        col('operations', 'jsonb', { notNull: true }),
      ],
      { ifNotExists: true },
    );

    expect(ast.table).toEqual({ schema: 'prisma_contract', name: 'ledger' });
    expect(ast.columns).toHaveLength(9);
    expect(ast.columns[0]).toMatchObject({ name: 'id', type: 'bigserial', primaryKey: true });
    expect(ast.collectParamRefs()).toEqual([]);
  });
});

describe('SQLite marker table via builder', () => {
  it('constructs the marker table AST matching the SQLite DDL shape', () => {
    const ast = createTable(
      '_prisma_marker',
      [
        col('space', 'text', {
          notNull: true,
          primaryKey: true,
          default: lit(APP_SPACE_ID),
        }),
        col('core_hash', 'text', { notNull: true }),
        col('profile_hash', 'text', { notNull: true }),
        col('contract_json', 'text'),
        col('canonical_version', 'int'),
        col('updated_at', 'text', { notNull: true, default: now() }),
        col('app_tag', 'text'),
        col('meta', 'text', { notNull: true, default: lit('{}') }),
        col('invariants', 'text', { notNull: true, default: lit('[]') }),
      ],
      { ifNotExists: true },
    );

    expect(ast.table).toEqual({ name: '_prisma_marker' });
    expect(ast.table.schema).toBeUndefined();
    expect(ast.columns).toHaveLength(9);
    expect(ast.columns[8]).toMatchObject({
      name: 'invariants',
      type: 'text',
      notNull: true,
      default: { kind: 'literal', value: '[]' },
    });
    expect(ast.collectParamRefs()).toEqual([]);
  });
});

describe('SQLite ledger table via builder', () => {
  it('constructs the ledger table AST matching the SQLite DDL shape', () => {
    const ast = createTable(
      '_prisma_ledger',
      [
        col('id', 'bigserial', { primaryKey: true }),
        col('created_at', 'text', { notNull: true, default: now() }),
        col('origin_core_hash', 'text'),
        col('origin_profile_hash', 'text'),
        col('destination_core_hash', 'text', { notNull: true }),
        col('destination_profile_hash', 'text'),
        col('contract_json_before', 'text'),
        col('contract_json_after', 'text'),
        col('operations', 'text', { notNull: true }),
      ],
      { ifNotExists: true },
    );

    expect(ast.table).toEqual({ name: '_prisma_ledger' });
    expect(ast.columns).toHaveLength(9);
    expect(ast.columns[0]).toMatchObject({ name: 'id', type: 'bigserial', primaryKey: true });
    expect(ast.collectParamRefs()).toEqual([]);
  });
});
