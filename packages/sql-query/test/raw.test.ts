import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ParamDescriptor, PlanMeta } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { createStubAdapter, createTestContext } from '../../runtime/test/utils';
import { validateContract } from '../src/contract';
import { rawOptions as exportedRawOptions, sql as exportedSql } from '../src/exports/sql';
import { rawOptions } from '../src/raw';
import { sql } from '../src/sql';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): SqlContract<SqlStorage> {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents) as unknown;
  return validateContract<SqlContract<SqlStorage>>(contractJson);
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
});
