import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Adapter,
  LoweredStatement,
  SelectAst,
  SqlContract,
  SqlStorage,
} from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { createTestContext } from '../../runtime/test/utils';
import { validateContract } from '../src/contract';
import { orm } from '../src/orm';
import { param } from '../src/param';
import type { Contract as RelationsContract } from './fixtures/contract-with-relations.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): RelationsContract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<RelationsContract>(contractJson);
}

function createStubAdapter(): Adapter<SelectAst, SqlContract<SqlStorage>, LoweredStatement> {
  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {
        postgres: {
          lateral: true,
          jsonAgg: true,
        },
      },
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

describe('orm includes', () => {
  const contract = loadContract('contract-with-relations');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const o = orm<RelationsContract>({ context });

  it('chains include.<relation>(child => ...)', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const builderWithInclude = (
      builder as {
        include: {
          posts: (child: unknown) => {
            where: (fn: (model: unknown) => unknown) => unknown;
            orderBy: (fn: (model: unknown) => unknown) => unknown;
            take: (n: number) => unknown;
            select: (fn: (model: unknown) => unknown) => unknown;
          };
        };
      }
    ).include.posts((child: unknown) => {
      const childBuilder = child as {
        where: (fn: (model: unknown) => unknown) => {
          orderBy: (fn: (model: unknown) => unknown) => {
            take: (n: number) => {
              select: (fn: (model: unknown) => unknown) => unknown;
            };
          };
        };
      };
      const result = childBuilder
        .where((p: unknown) => {
          const model = p as { id: { eq: (p: unknown) => unknown } };
          return model.id.eq(param('postId'));
        })
        .orderBy((p: unknown) => {
          const model = p as { id: { desc: () => unknown } };
          return model.id.desc();
        })
        .take(10)
        .select((p: unknown) => {
          const model = p as { id: unknown; title: unknown };
          return { id: model.id, title: model.title };
        });
      return result;
    });

    expect(builderWithInclude).toBeDefined();
  });

  it('builds plan with include', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    // @ts-expect-error - intentionally using type assertions in test
    const builderWithInclude: unknown = (
      builder as {
        include: {
          posts: (child: unknown) => unknown;
        };
        select: (fn: (model: unknown) => unknown) => unknown;
      }
    ).include
      .posts((child: unknown) => {
        const childBuilder = child as {
          select: (fn: (model: unknown) => unknown) => unknown;
        };
        return childBuilder.select((p: unknown) => {
          const model = p as { id: unknown; title: unknown };
          return { id: model.id, title: model.title };
        });
      })
      .select((u: unknown) => {
        const model = u as { id: unknown; email: unknown; posts: boolean };
        return { id: model.id, email: model.email, posts: true };
      });
    const plan = (
      builderWithInclude as {
        findMany: (options?: { params?: Record<string, unknown> }) => unknown;
      }
    ).findMany({ params: { since: '2024-01-01' } });

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
    expect((plan as { ast: { kind: string } }).ast?.kind).toBe('select');
    // Check that the AST has includes
    const ast = plan as { ast: { includes?: unknown[] } };
    expect(ast.ast?.includes).toBeDefined();
    expect(Array.isArray(ast.ast?.includes)).toBe(true);
    if (Array.isArray(ast.ast?.includes) && ast.ast.includes.length > 0) {
      const include = ast.ast.includes[0] as { kind: string; alias: string };
      expect(include.kind).toBe('includeMany');
      expect(include.alias).toBe('posts');
    }
  });

  it('supports chaining include with other methods', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    // @ts-expect-error - intentionally using type assertions in test
    const builderWithInclude: unknown = (
      builder as {
        include: {
          posts: (child: unknown) => unknown;
        };
        where: (fn: (model: unknown) => unknown) => unknown;
      }
    ).include
      .posts((child: unknown) => {
        const childBuilder = child as {
          select: (fn: (model: unknown) => unknown) => unknown;
        };
        return childBuilder.select((p: unknown) => {
          const model = p as { id: unknown };
          return { id: model.id };
        });
      })
      .where((u: unknown) => {
        const model = u as { id: { eq: (p: unknown) => unknown } };
        return model.id.eq(param('userId'));
      });
    const plan = (
      builderWithInclude as {
        findMany: (options?: { params?: Record<string, unknown> }) => unknown;
      }
    ).findMany({ params: { userId: 1 } });

    expect(plan).toBeDefined();
    const ast = plan as { ast: { includes?: unknown[] } };
    expect(ast.ast?.includes).toBeDefined();
    if (Array.isArray(ast.ast?.includes)) {
      expect(ast.ast.includes.length).toBe(1);
    }
  });

  it('throws error when accessing invalid relation', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const builderInclude = (builder as { include: unknown }).include;

    expect(() => {
      (
        builderInclude as {
          invalidRelation: (child: unknown) => unknown;
        }
      ).invalidRelation((child: unknown) => child);
    }).toThrow('Relation invalidRelation not found on model User');
  });

  it('throws error when capabilities are missing', () => {
    // Create a contract without capabilities
    const contractWithoutCaps = {
      ...contract,
      capabilities: {},
    } as RelationsContract;
    const adapterWithoutCapabilities: Adapter<
      SelectAst,
      SqlContract<SqlStorage>,
      LoweredStatement
    > = {
      profile: {
        id: 'stub-profile',
        target: 'postgres',
        capabilities: {},
        codecs() {
          return createCodecRegistry();
        },
      },
      lower(
        ast: SelectAst,
        ctx: { contract: SqlContract<SqlStorage>; params?: readonly unknown[] },
      ) {
        const sqlText = JSON.stringify(ast);
        return {
          profileId: this.profile.id,
          body: Object.freeze({ sql: sqlText, params: ctx.params ? [...ctx.params] : [] }),
        };
      },
    };
    const contextWithoutCaps = createTestContext(contractWithoutCaps, adapterWithoutCapabilities);
    const oWithoutCaps = orm<RelationsContract>({ context: contextWithoutCaps });
    const builder = (oWithoutCaps as unknown as { user: () => unknown }).user();
    const builderWithInclude = (
      builder as {
        include: {
          posts: (child: unknown) => unknown;
        };
      }
    ).include.posts((child: unknown) => {
      const childBuilder = child as {
        select: (fn: (model: unknown) => unknown) => unknown;
      };
      return childBuilder.select((p: unknown) => {
        const model = p as { id: unknown };
        return { id: model.id };
      });
    });

    expect(() => {
      (builderWithInclude as { findMany: () => unknown }).findMany();
    }).toThrow('includeMany requires lateral and jsonAgg capabilities');
  });

  it('throws error when child projection is missing', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const builderWithInclude = (
      builder as {
        include: {
          posts: (child: unknown) => unknown;
        };
      }
    ).include.posts((child: unknown) => {
      // Don't call select() - this should cause an error
      return child;
    });

    expect(() => {
      (builderWithInclude as { findMany: () => unknown }).findMany();
    }).toThrow('Child projection must be specified');
  });

  it('throws error when capabilities are missing for target', () => {
    const contractWithoutTargetCaps = {
      ...contract,
      capabilities: {
        postgres: {},
      },
    } as RelationsContract;
    const adapterWithoutCaps = createStubAdapter();
    const contextWithoutCaps = createTestContext(contractWithoutTargetCaps, adapterWithoutCaps);
    const oWithoutCaps = orm<RelationsContract>({ context: contextWithoutCaps });
    const builder = (oWithoutCaps as unknown as { user: () => unknown }).user();
    const builderWithInclude = (
      builder as {
        include: {
          posts: (child: unknown) => unknown;
        };
      }
    ).include.posts((child: unknown) => {
      const childBuilder = child as {
        select: (fn: (model: unknown) => unknown) => unknown;
      };
      return childBuilder.select((p: unknown) => {
        const model = p as { id: unknown };
        return { id: model.id };
      });
    });

    expect(() => {
      (builderWithInclude as { findMany: () => unknown }).findMany();
    }).toThrow('includeMany requires lateral and jsonAgg capabilities');
  });

  it('throws error when capabilities are false instead of true', () => {
    const contractWithFalseCaps = {
      ...contract,
      capabilities: {
        postgres: {
          lateral: false,
          jsonAgg: false,
        },
      },
    } as RelationsContract;
    const adapterWithFalseCaps = createStubAdapter();
    const contextWithFalseCaps = createTestContext(contractWithFalseCaps, adapterWithFalseCaps);
    const oWithFalseCaps = orm<RelationsContract>({ context: contextWithFalseCaps });
    const builder = (oWithFalseCaps as unknown as { user: () => unknown }).user();
    const builderWithInclude = (
      builder as {
        include: {
          posts: (child: unknown) => unknown;
        };
      }
    ).include.posts((child: unknown) => {
      const childBuilder = child as {
        select: (fn: (model: unknown) => unknown) => unknown;
      };
      return childBuilder.select((p: unknown) => {
        const model = p as { id: unknown };
        return { id: model.id };
      });
    });

    expect(() => {
      (builderWithInclude as { findMany: () => unknown }).findMany();
    }).toThrow('includeMany requires lateral and jsonAgg capabilities to be true');
  });

  it('throws error when child projection has only boolean values', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const builderWithInclude = (
      builder as {
        include: {
          posts: (child: unknown) => unknown;
        };
      }
    ).include.posts((child: unknown) => {
      const childBuilder = child as {
        select: (fn: (model: unknown) => unknown) => unknown;
      };
      // Return projection with only boolean values (should be filtered out)
      return childBuilder.select(() => {
        return { id: true, title: false };
      });
    });

    expect(() => {
      (builderWithInclude as { findMany: () => unknown }).findMany();
    }).toThrow('Child projection must not be empty after filtering boolean values');
  });
});
