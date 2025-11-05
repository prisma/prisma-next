import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { rawOptions } from '../src/raw';
import { sql } from '../src/sql';
import { sql as exportedSql, rawOptions as exportedRawOptions } from '../src/exports/sql';
import { validateContract } from '../src/contract';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import type { Adapter, LoweredStatement, ParamDescriptor, PlanMeta, SelectAst } from '../src/types';
import { createCodecRegistry } from '@prisma-next/sql-target';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): SqlContract<SqlStorage> {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents) as unknown;
  return validateContract<SqlContract<SqlStorage>>(contractJson);
}

function createStubAdapter(): Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement> {
  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return createCodecRegistry();
      },
    },
    lower(ast: SelectAst, ctx: { contract: SqlContract<SqlStorage>; params?: readonly unknown[] }) {
      const sqlText = JSON.stringify(ast);
      return {
        profileId: this.profile.id,
        body: Object.freeze({ sql: sqlText, params: ctx.params ? [...ctx.params] : [] }),
      };
    },
  };
}

describe('raw lane', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const root = sql({ contract, adapter });

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
    const exportedRoot = exportedSql({ contract, adapter });
    expect(typeof exportedRoot.raw).toBe('function');

    const plan = exportedRoot.raw('select 1', { params: [] });
    expect(plan.sql).toBe('select 1');
    expect(exportedRawOptions({ refs: { tables: [] } })).toBeDefined();
  });
});
