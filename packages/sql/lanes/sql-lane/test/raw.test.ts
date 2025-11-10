import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParamDescriptor, PlanMeta } from '@prisma-next/contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { SqlContract, SqlMappings } from '@prisma-next/sql-contract-types';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { rawOptions as exportedRawOptions, sql as exportedSql } from '../src/exports/sql';
import { rawOptions } from '../src/raw';
import { sql } from '../src/sql/builder';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

type FixtureContract = SqlContract<
  {
    readonly tables: {
      readonly user: {
        readonly columns: {
          readonly id: { readonly type: 'pg/int4@1'; readonly nullable: false };
          readonly email: { readonly type: 'pg/text@1'; readonly nullable: false };
          readonly createdAt: { readonly type: 'pg/timestamptz@1'; readonly nullable: false };
        };
        readonly primaryKey: { readonly columns: readonly ['id'] };
        readonly uniques: readonly [];
        readonly indexes: readonly [];
        readonly foreignKeys: readonly [];
      };
    };
  },
  {
    readonly User: {
      readonly storage: { readonly table: 'user' };
      readonly fields: {
        readonly id: { readonly column: 'id' };
        readonly email: { readonly column: 'email' };
        readonly createdAt: { readonly column: 'createdAt' };
      };
      readonly relations: Record<string, never>;
    };
  },
  Record<string, never>,
  SqlMappings
> & {
  readonly capabilities?: {
    readonly postgres?: {
      readonly returning?: boolean;
    };
  };
};

function loadContract(name: string): FixtureContract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents) as unknown;
  return validateContract<FixtureContract>(contractJson);
}

describe('raw lane', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const root = sql({ context });

  it('compiles template literals to positional placeholders with stable params', () => {
    const userId = 42;
    const status = 'active';
    const limit = 5;

    const plan = root.raw`
      select id, email from "user"
      where id = ${userId} and status = ${status}
      limit ${limit}
    `;

    expect(plan.sql).toContain('where id = $1 and status = $2');
    expect(plan.sql.trim().endsWith('limit $3')).toBe(true);
    expect(plan.params).toEqual([userId, status, limit]);

    expect(plan.meta.paramDescriptors).toEqual<ReadonlyArray<ParamDescriptor>>([
      { index: 1, name: 'p1', source: 'raw' },
      { index: 2, name: 'p2', source: 'raw' },
      { index: 3, name: 'p3', source: 'raw' },
    ]);

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.params)).toBe(true);
    expect(Object.isFrozen(plan.meta)).toBe(true);
  });

  it('augments template plans with metadata via rawOptions sentinel', () => {
    const email = 'ada@example.com';

    const plan = root.raw`
      select id from "user"
      where email = ${email}
      ${rawOptions({
        refs: { tables: ['user'], columns: [{ table: 'user', column: 'email' }] },
        annotations: { intent: 'report' },
        projection: ['id'],
      })}
    `;

    expect(plan.params).toEqual([email]);

    const meta = plan.meta as PlanMeta;
    expect(meta.annotations).toEqual({ intent: 'report' });
    expect(meta.refs).toEqual({
      tables: ['user'],
      columns: [{ table: 'user', column: 'email' }],
    });
    expect(meta.projection).toEqual(['id']);
    expect(Object.isFrozen(meta.refs)).toBe(true);
    expect(Object.isFrozen(meta.projection)).toBe(true);
  });

  it('builds function-form plans preserving text and metadata', () => {
    const plan = root.raw('select id from "user" where created_at < $1 limit $2', {
      params: [new Date('2024-01-01T00:00:00Z'), 10],
      refs: { tables: ['user'] },
      annotations: { intent: 'report' },
      projection: ['id'],
    });

    expect(plan.sql).toBe('select id from "user" where created_at < $1 limit $2');
    expect(plan.params.length).toBe(2);
    expect(plan.meta.paramDescriptors).toEqual<ReadonlyArray<ParamDescriptor>>([
      { index: 1, name: 'p1', source: 'raw' },
      { index: 2, name: 'p2', source: 'raw' },
    ]);

    const meta = plan.meta as PlanMeta;
    expect(meta.annotations).toEqual({ intent: 'report' });
    expect(meta.refs?.tables).toEqual(['user']);
    expect(meta.projection).toEqual(['id']);
  });

  it('exposes raw via the package export surface', () => {
    const exportedRoot = exportedSql({ context });
    expect(typeof exportedRoot.raw).toBe('function');

    const plan = exportedRoot.raw('select 1', { params: [] });
    expect(plan.sql).toBe('select 1');
    expect(exportedRawOptions({ refs: { tables: [] } })).toBeDefined();
  });

  it('handles raw with empty params', () => {
    const plan = root.raw('select 1', { params: [] });
    expect(plan.sql).toBe('select 1');
    expect(plan.params).toEqual([]);
  });

  it('handles raw with multiple params', () => {
    const plan = root.raw('select * from "user" where id = $1 and email = $2', {
      params: ['test-id', 'test@example.com'],
    });
    expect(plan.sql).toBe('select * from "user" where id = $1 and email = $2');
    expect(plan.params).toEqual(['test-id', 'test@example.com']);
  });

  it('handles raw with with() method', () => {
    const plan = root.raw.with({ annotations: { limit: 10 } })`select * from "user"`;
    expect(plan.meta.annotations).toEqual({ limit: 10 });
  });

  it('handles raw with with() and template literal', () => {
    const userId = 42;
    const plan = root.raw.with({ annotations: { limit: 10 } })`
      select * from "user" where id = ${userId}
    `;
    expect(plan.sql).toContain('where id = $1');
    expect(plan.params).toEqual([userId]);
    expect(plan.meta.annotations).toEqual({ limit: 10 });
  });

  it('throws error when target is not postgres', () => {
    const invalidContract = {
      ...contract,
      target: 'mysql' as 'postgres',
    };
    const invalidContext = createTestContext(invalidContract, adapter);

    expect(() => {
      sql({ context: invalidContext });
    }).toThrow('Raw lane currently supports only postgres target');
  });

  it('throws error when function form is called without params option', () => {
    expect(() => {
      (root.raw as unknown as (first: string, ...rest: unknown[]) => unknown)(
        'select 1' as unknown as string,
      );
    }).toThrow('Function form requires params option');
  });

  it('throws error when function form params is not an array', () => {
    expect(() => {
      root.raw('select 1', { params: 'not-an-array' as unknown as unknown[] });
    }).toThrow('Function form params must be an array');
  });

  it('handles splitTemplateValues with empty values', () => {
    const plan = root.raw`select 1`;
    expect(plan.sql).toBe('select 1');
    expect(plan.params).toEqual([]);
  });

  it('handles splitTemplateValues with options sentinel', () => {
    const plan = root.raw`
      select 1
      ${rawOptions({ annotations: { test: true } })}
    `;
    expect(plan.meta.annotations).toEqual({ test: true });
  });

  it('handles raw with refs containing indexes', () => {
    const plan = root.raw('select 1', {
      params: [],
      refs: {
        tables: ['user'],
        columns: [{ table: 'user', column: 'id' }],
        indexes: [
          { table: 'user', columns: ['id'], name: 'user_id_idx' },
          { table: 'user', columns: ['email'] },
        ],
      },
    });

    expect(plan.meta.refs?.indexes).toBeDefined();
    if (plan.meta.refs?.indexes) {
      expect(plan.meta.refs.indexes.length).toBe(2);
      expect(plan.meta.refs.indexes[0]).toMatchObject({
        table: 'user',
        columns: ['id'],
        name: 'user_id_idx',
      });
      expect(plan.meta.refs.indexes[1]).toMatchObject({
        table: 'user',
        columns: ['email'],
      });
    }
  });
});
