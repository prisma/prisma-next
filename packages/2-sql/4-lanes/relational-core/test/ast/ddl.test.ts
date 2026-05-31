import { APP_SPACE_ID } from '@prisma-next/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  type AnyQueryAst,
  CreateSchemaAst,
  CreateTableAst,
  isQueryAst,
  queryAstKinds,
} from '../../src/exports/ast';

describe('CreateSchemaAst', () => {
  it('carries name and ifNotExists', () => {
    const ast = CreateSchemaAst.of('prisma_contract', true);
    expect(ast.kind).toBe('create-schema');
    expect(ast.name).toBe('prisma_contract');
    expect(ast.ifNotExists).toBe(true);
  });

  it('defaults ifNotExists to false', () => {
    const ast = CreateSchemaAst.of('my_schema');
    expect(ast.ifNotExists).toBe(false);
  });

  it('is frozen', () => {
    const ast = CreateSchemaAst.of('prisma_contract', true);
    expect(Object.isFrozen(ast)).toBe(true);
  });

  it('collectParamRefs returns empty array', () => {
    const ast = CreateSchemaAst.of('prisma_contract', true);
    expect(ast.collectParamRefs()).toEqual([]);
  });

  it('rewrite returns same instance', () => {
    const ast = CreateSchemaAst.of('prisma_contract', true);
    expect(ast.rewrite({})).toBe(ast);
  });

  it('toQueryAst returns self', () => {
    const ast = CreateSchemaAst.of('prisma_contract', true);
    expect(ast.toQueryAst()).toBe(ast);
  });

  it('isQueryAst returns true', () => {
    const ast = CreateSchemaAst.of('prisma_contract', true);
    expect(isQueryAst(ast)).toBe(true);
  });
});

describe('CreateTableAst', () => {
  const minimalTable = CreateTableAst.of(
    { name: 'marker' },
    [{ name: 'id', type: 'text', primaryKey: true, notNull: true }],
    { ifNotExists: true },
  );

  it('carries table, columns, and ifNotExists', () => {
    expect(minimalTable.kind).toBe('create-table');
    expect(minimalTable.table).toEqual({ name: 'marker' });
    expect(minimalTable.ifNotExists).toBe(true);
    expect(minimalTable.columns).toHaveLength(1);
  });

  it('defaults ifNotExists to false', () => {
    const ast = CreateTableAst.of({ name: 't' }, []);
    expect(ast.ifNotExists).toBe(false);
  });

  it('carries schema qualifier when provided', () => {
    const ast = CreateTableAst.of({ schema: 'prisma_contract', name: 'marker' }, [], {
      ifNotExists: true,
    });
    expect(ast.table).toEqual({ schema: 'prisma_contract', name: 'marker' });
  });

  it('is frozen', () => {
    expect(Object.isFrozen(minimalTable)).toBe(true);
  });

  it('freezes columns array', () => {
    expect(Object.isFrozen(minimalTable.columns)).toBe(true);
  });

  it('freezes each column descriptor', () => {
    for (const col of minimalTable.columns) {
      expect(Object.isFrozen(col)).toBe(true);
    }
  });

  it('collectParamRefs returns empty array', () => {
    expect(minimalTable.collectParamRefs()).toEqual([]);
  });

  it('rewrite returns same instance', () => {
    expect(minimalTable.rewrite({})).toBe(minimalTable);
  });

  it('toQueryAst returns self', () => {
    expect(minimalTable.toQueryAst()).toBe(minimalTable);
  });

  it('isQueryAst returns true', () => {
    expect(isQueryAst(minimalTable)).toBe(true);
  });
});

describe('queryAstKinds', () => {
  it('includes create-schema', () => {
    expect(queryAstKinds.has('create-schema')).toBe(true);
  });

  it('includes create-table', () => {
    expect(queryAstKinds.has('create-table')).toBe(true);
  });
});

describe('AnyQueryAst DDL exhaustiveness', () => {
  it('create-schema satisfies AnyQueryAst type', () => {
    const ast: AnyQueryAst = CreateSchemaAst.of('s');
    expect(ast.kind).toBe('create-schema');
  });

  it('create-table satisfies AnyQueryAst type', () => {
    const ast: AnyQueryAst = CreateTableAst.of({ name: 't' }, []);
    expect(ast.kind).toBe('create-table');
  });
});

describe('CreateTableAst — marker + ledger column shapes', () => {
  it('expresses the marker table with neutral column descriptors', () => {
    const ast = CreateTableAst.of(
      { schema: 'prisma_contract', name: 'marker' },
      [
        {
          name: 'space',
          type: 'text',
          notNull: true,
          primaryKey: true,
          default: { kind: 'literal', value: APP_SPACE_ID },
        },
        { name: 'core_hash', type: 'text', notNull: true },
        { name: 'profile_hash', type: 'text', notNull: true },
        { name: 'contract_json', type: 'jsonb' },
        { name: 'canonical_version', type: 'int' },
        { name: 'updated_at', type: 'timestamptz', notNull: true, default: { kind: 'now' } },
        { name: 'app_tag', type: 'text' },
        {
          name: 'meta',
          type: 'jsonb',
          notNull: true,
          default: { kind: 'empty-collection' },
        },
        {
          name: 'invariants',
          type: 'text-array',
          notNull: true,
          default: { kind: 'empty-collection' },
        },
      ],
      { ifNotExists: true },
    );

    expect(ast.columns).toHaveLength(9);
    expect(ast.columns[0]).toMatchObject({ name: 'space', type: 'text', primaryKey: true });
    expect(ast.columns[5]).toMatchObject({
      name: 'updated_at',
      type: 'timestamptz',
      default: { kind: 'now' },
    });
    expect(ast.columns[8]).toMatchObject({
      name: 'invariants',
      type: 'text-array',
      default: { kind: 'empty-collection' },
    });
    expect(ast.collectParamRefs()).toEqual([]);
  });

  it('expresses the ledger table with neutral column descriptors', () => {
    const ast = CreateTableAst.of(
      { schema: 'prisma_contract', name: 'ledger' },
      [
        { name: 'id', type: 'bigserial', primaryKey: true },
        { name: 'created_at', type: 'timestamptz', notNull: true, default: { kind: 'now' } },
        { name: 'origin_core_hash', type: 'text' },
        { name: 'origin_profile_hash', type: 'text' },
        { name: 'destination_core_hash', type: 'text', notNull: true },
        { name: 'destination_profile_hash', type: 'text' },
        { name: 'contract_json_before', type: 'jsonb' },
        { name: 'contract_json_after', type: 'jsonb' },
        { name: 'operations', type: 'jsonb', notNull: true },
      ],
      { ifNotExists: true },
    );

    expect(ast.columns).toHaveLength(9);
    expect(ast.columns[0]).toMatchObject({ name: 'id', type: 'bigserial', primaryKey: true });
    expect(ast.collectParamRefs()).toEqual([]);
  });
});
