import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { Adapter, LoweredStatement, SelectAst } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { orm } from '../src/orm.ts';
import type { Contract } from './fixtures/contract.d.ts';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): Contract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<Contract>(contractJson);
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

describe('orm entrypoint', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);

  it('exposes valid model names as properties', () => {
    const o = orm<Contract>({ context });

    expect(o).toHaveProperty('user');
    expect(typeof (o as unknown as { user: () => unknown }).user).toBe('function');
  });

  it('returns OrmModelBuilder when accessing model', () => {
    const o = orm<Contract>({ context });

    const builder = (o as unknown as { user: () => unknown }).user();

    expect(builder).toBeDefined();
    expect(typeof (builder as { where: unknown }).where).toBe('function');
    expect(typeof (builder as { select: unknown }).select).toBe('function');
    expect(typeof (builder as { findMany: unknown }).findMany).toBe('function');
  });

  it('throws error when accessing invalid model at runtime', () => {
    const o = orm<Contract>({ context });

    expect(() => {
      (o as unknown as { invalidModel: () => unknown }).invalidModel();
    }).toThrow();
  });

  it('returns undefined for non-string property access', () => {
    const o = orm<Contract>({ context });

    expect((o as unknown as Record<symbol, unknown>)[Symbol('test')]).toBeUndefined();
  });

  it('returns false for non-string property in has check', () => {
    const o = orm<Contract>({ context });

    expect(Symbol('test') in (o as unknown as Record<symbol, unknown>)).toBe(false);
  });
});
