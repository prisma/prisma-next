import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { validateContract } from '../src/contract';
import { param } from '../src/param';
import { orm } from '../src/orm';
import type { Adapter, LoweredStatement, SelectAst } from '../src/types';
import type { CodecTypes, Contract } from './fixtures/contract.d';

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

describe('orm base builder', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const codecTypes = {} as CodecTypes;
  const o = orm<Contract, CodecTypes>({ contract, adapter, codecTypes });

  it('chains where clause', () => {
    const builder = (o as { user: () => unknown }).user();
    const builderWithWhere = (builder as { where: (fn: (m: unknown) => unknown) => unknown }).where(
      (m: unknown) => {
        const model = m as { id: { eq: (p: unknown) => unknown } };
        return model.id.eq(param('userId'));
      },
    );

    expect(builderWithWhere).toBeDefined();
    expect(typeof (builderWithWhere as { findMany: () => unknown }).findMany).toBe('function');
  });

  it('chains orderBy clause', () => {
    const builder = (o as { user: () => unknown }).user();
    const builderWithOrder = (
      builder as { orderBy: (fn: (m: unknown) => unknown) => unknown }
    ).orderBy((m: unknown) => {
      const model = m as { createdAt: { desc: () => unknown } };
      return model.createdAt.desc();
    });

    expect(builderWithOrder).toBeDefined();
  });

  it('chains take limit', () => {
    const builder = (o as { user: () => unknown }).user();
    const builderWithLimit = (builder as { take: (n: number) => unknown }).take(10);

    expect(builderWithLimit).toBeDefined();
  });

  it('chains skip offset', () => {
    const builder = (o as { user: () => unknown }).user();
    const builderWithSkip = (builder as { skip: (n: number) => unknown }).skip(5);

    expect(builderWithSkip).toBeDefined();
  });

  it('chains select projection', () => {
    const builder = (o as { user: () => unknown }).user();
    const builderWithSelect = (
      builder as { select: (fn: (m: unknown) => unknown) => unknown }
    ).select((m: unknown) => {
      const model = m as { id: unknown; email: unknown };
      return { id: model.id, email: model.email };
    });

    expect(builderWithSelect).toBeDefined();
  });

  it('builds plan with findMany', () => {
    const builder = (o as { user: () => unknown }).user();
    const plan = (builder as { findMany: () => unknown }).findMany({ params: {} });

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
    expect((plan as { ast: { kind: string } }).ast?.kind).toBe('select');
  });

  it('builds plan with findFirst', () => {
    const builder = (o as { user: () => unknown }).user();
    const plan = (builder as { findFirst: () => unknown }).findFirst({ params: {} });

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
    expect((plan as { ast: { limit: number } }).ast?.limit).toBe(1);
  });

  it('builds plan with findUnique', () => {
    const builder = (o as { user: () => unknown }).user();
    const plan = (
      builder as {
        findUnique: (
          where: (m: unknown) => unknown,
          options?: { params: Record<string, unknown> },
        ) => unknown;
      }
    ).findUnique(
      (m: unknown) => {
        const model = m as { id: { eq: (p: unknown) => unknown } };
        return model.id.eq(param('userId'));
      },
      { params: { userId: 1 } },
    );

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
    expect((plan as { ast: { limit: number } }).ast?.limit).toBe(1);
  });
});
