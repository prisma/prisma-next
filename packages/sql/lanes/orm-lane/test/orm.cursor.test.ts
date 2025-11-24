import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import type { Adapter, LoweredStatement, SelectAst } from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import type { RuntimeContext } from '@prisma-next/sql-runtime';
import { createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { orm } from '../src/orm';
import type { Contract } from './fixtures/contract.d';

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

describe('orm cursor', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const o = orm<Contract>({ context });

  it('builds plan with cursor gt', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as {
        cursor: (fn: (m: unknown) => unknown) => { findMany: (options?: { params?: Record<string, unknown> }) => unknown };
      }
    )
      .cursor((m: unknown) => {
        const model = m as { id: { gt: (p: unknown) => unknown } };
        return model.id.gt(param('lastId'));
      })
      .findMany({ params: { lastId: 42 } });

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
    const ast = plan as { ast: { where?: unknown; orderBy?: ReadonlyArray<{ dir: string }> } };
    expect(ast.ast?.where).toBeDefined();
    expect(ast.ast?.orderBy).toBeDefined();
    expect(ast.ast?.orderBy?.[0]?.dir).toBe('asc');
  });

  it('builds plan with cursor gte', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as {
        cursor: (fn: (m: unknown) => unknown) => { findMany: (options?: { params?: Record<string, unknown> }) => unknown };
      }
    )
      .cursor((m: unknown) => {
        const model = m as { id: { gte: (p: unknown) => unknown } };
        return model.id.gte(param('lastId'));
      })
      .findMany({ params: { lastId: 42 } });

    expect(plan).toBeDefined();
    const ast = plan as { ast: { where?: unknown; orderBy?: ReadonlyArray<{ dir: string }> } };
    expect(ast.ast?.where).toBeDefined();
    expect(ast.ast?.orderBy?.[0]?.dir).toBe('asc');
  });

  it('builds plan with cursor lt', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as {
        cursor: (fn: (m: unknown) => unknown) => { findMany: (options?: { params?: Record<string, unknown> }) => unknown };
      }
    )
      .cursor((m: unknown) => {
        const model = m as { id: { lt: (p: unknown) => unknown } };
        return model.id.lt(param('lastId'));
      })
      .findMany({ params: { lastId: 42 } });

    expect(plan).toBeDefined();
    const ast = plan as { ast: { where?: unknown; orderBy?: ReadonlyArray<{ dir: string }> } };
    expect(ast.ast?.where).toBeDefined();
    expect(ast.ast?.orderBy?.[0]?.dir).toBe('desc');
  });

  it('builds plan with cursor lte', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as {
        cursor: (fn: (m: unknown) => unknown) => { findMany: (options?: { params?: Record<string, unknown> }) => unknown };
      }
    )
      .cursor((m: unknown) => {
        const model = m as { id: { lte: (p: unknown) => unknown } };
        return model.id.lte(param('lastId'));
      })
      .findMany({ params: { lastId: 42 } });

    expect(plan).toBeDefined();
    const ast = plan as { ast: { where?: unknown; orderBy?: ReadonlyArray<{ dir: string }> } };
    expect(ast.ast?.where).toBeDefined();
    expect(ast.ast?.orderBy?.[0]?.dir).toBe('desc');
  });

  it('builds plan with undefined cursor', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as {
        cursor: (fn: (m: unknown) => unknown) => { findMany: (options?: { params?: Record<string, unknown> }) => unknown };
      }
    )
      .cursor(() => undefined)
      .findMany({ params: {} });

    expect(plan).toBeDefined();
    const ast = plan as { ast: { where?: unknown; orderBy?: ReadonlyArray<unknown> } };
    // No WHERE clause added for undefined cursor
    // No ORDER BY added for undefined cursor
    expect(ast.ast?.orderBy).toBeUndefined();
  });

  it('combines cursor with existing WHERE clause', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as {
        where: (fn: (m: unknown) => unknown) => {
          cursor: (fn: (m: unknown) => unknown) => {
            findMany: (options?: { params?: Record<string, unknown> }) => unknown;
          };
        };
      }
    )
      .where((m: unknown) => {
        const model = m as { email: { eq: (p: unknown) => unknown } };
        return model.email.eq(param('email'));
      })
      .cursor((m: unknown) => {
        const model = m as { id: { gt: (p: unknown) => unknown } };
        return model.id.gt(param('lastId'));
      })
      .findMany({ params: { email: 'test@example.com', lastId: 42 } });

    expect(plan).toBeDefined();
    const ast = plan as { ast: { where?: unknown } };
    // WHERE clause should be combined with AND
    expect(ast.ast?.where).toBeDefined();
  });

  it('cursor ORDER BY overrides explicit orderBy', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as {
        orderBy: (fn: (m: unknown) => unknown) => {
          cursor: (fn: (m: unknown) => unknown) => {
            findMany: (options?: { params?: Record<string, unknown> }) => unknown;
          };
        };
      }
    )
      .orderBy((m: unknown) => {
        const model = m as { createdAt: { desc: () => unknown } };
        return model.createdAt.desc();
      })
      .cursor((m: unknown) => {
        const model = m as { id: { gt: (p: unknown) => unknown } };
        return model.id.gt(param('lastId'));
      })
      .findMany({ params: { lastId: 42 } });

    expect(plan).toBeDefined();
    const ast = plan as { ast: { orderBy?: ReadonlyArray<{ dir: string }> } };
    // Cursor ORDER BY (ASC) should override explicit orderBy (DESC)
    expect(ast.ast?.orderBy?.[0]?.dir).toBe('asc');
  });

  it('chains cursor with take', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as {
        cursor: (fn: (m: unknown) => unknown) => {
          take: (n: number) => { findMany: (options?: { params?: Record<string, unknown> }) => unknown };
        };
      }
    )
      .cursor((m: unknown) => {
        const model = m as { id: { gt: (p: unknown) => unknown } };
        return model.id.gt(param('lastId'));
      })
      .take(10)
      .findMany({ params: { lastId: 42 } });

    expect(plan).toBeDefined();
    const ast = plan as { ast: { limit?: number } };
    expect(ast.ast?.limit).toBe(10);
  });
});
