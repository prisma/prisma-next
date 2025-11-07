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
import type { CodecTypes, Contract } from './fixtures/contract-with-relations.d';

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

describe('orm relation filters', () => {
  const contract = loadContract('contract-with-relations');
  const adapter = createStubAdapter();
  const codecTypes = {} as CodecTypes;
  const o = orm<Contract, CodecTypes>({ contract, adapter, codecTypes });

  it('chains where.related.<relation>.some()', () => {
    const builder = (o as unknown as { post: () => unknown }).post();
    const builderWithFilter = (
      builder as {
        where: {
          related: {
            user: {
              some: (fn: (child: unknown) => unknown) => unknown;
            };
          };
        };
      }
    ).where.related.user.some((child: unknown) => {
      const model = child as { id: { eq: (p: unknown) => unknown } };
      return model.id.eq(param('userId'));
    });

    expect(builderWithFilter).toBeDefined();
    expect(typeof (builderWithFilter as { findMany: () => unknown }).findMany).toBe('function');
  });

  it('chains where.related.<relation>.none()', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const builderWithFilter = (
      builder as {
        where: {
          related: {
            posts: {
              none: (fn: (child: unknown) => unknown) => unknown;
            };
          };
        };
      }
    ).where.related.posts.none((child: unknown) => {
      const model = child as { id: { eq: (p: unknown) => unknown } };
      return model.id.eq(param('postId'));
    });

    expect(builderWithFilter).toBeDefined();
  });

  it('chains where.related.<relation>.every()', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const builderWithFilter = (
      builder as {
        where: {
          related: {
            posts: {
              every: (fn: (child: unknown) => unknown) => unknown;
            };
          };
        };
      }
    ).where.related.posts.every((child: unknown) => {
      const model = child as { title: { eq: (p: unknown) => unknown } };
      return model.title.eq(param('title'));
    });

    expect(builderWithFilter).toBeDefined();
  });

  it('builds plan with where.related.some() filter', () => {
    const builder = (o as unknown as { post: () => unknown }).post();
    const builderWithFilter = (
      builder as {
        where: {
          related: {
            user: {
              some: (fn: (child: unknown) => unknown) => unknown;
            };
          };
        };
      }
    ).where.related.user.some((child: unknown) => {
      const model = child as { id: { eq: (p: unknown) => unknown } };
      return model.id.eq(param('userId'));
    });
    const plan = (builderWithFilter as { findMany: (options?: { params?: Record<string, unknown> }) => unknown }).findMany({ params: { userId: 1 } });

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
    expect((plan as { ast: { kind: string } }).ast?.kind).toBe('select');
    // TODO: Once EXISTS subqueries are implemented, check that the AST has a where clause with EXISTS
    // For now, relation filters are stored but not yet compiled to EXISTS subqueries
  });

  it('throws error when accessing invalid relation', () => {
    const builder = (o as unknown as { user: () => unknown }).user();

    expect(() => {
      (
        builder as {
          where: {
            related: {
              invalidRelation: {
                some: (fn: (child: unknown) => unknown) => unknown;
              };
            };
          };
        }
      ).where.related.invalidRelation.some(() => {
        throw new Error('Should not be called');
      });
    }).toThrow();
  });
});

