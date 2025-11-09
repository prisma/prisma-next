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
import type { Contract } from './fixtures/contract-with-relations.d';

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
  const context = createTestContext(contract, adapter);
  const o = orm<Contract>({ context });

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

  it('chains where.related.<relation>.some() with where() on child', () => {
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
      const filterBuilder = child as {
        where: (fn: (model: unknown) => unknown) => unknown;
      };
      return filterBuilder.where((model: unknown) => {
        const m = model as { id: { eq: (p: unknown) => unknown } };
        return m.id.eq(param('userId'));
      });
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
    const plan = (
      builderWithFilter as { findMany: (options?: { params?: Record<string, unknown> }) => unknown }
    ).findMany({ params: { userId: 1 } });

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
    expect((plan as { ast: { kind: string } }).ast?.kind).toBe('select');
    // TODO: Once EXISTS subqueries are implemented, check that the AST has a where clause with EXISTS
    // For now, relation filters are stored but not yet compiled to EXISTS subqueries
  });

  it('builds plan with where.related.some() filter and main where clause', () => {
    const builder = (o as unknown as { post: () => unknown }).post();
    const builderWithWhere = (
      builder as {
        where: (fn: (model: unknown) => unknown) => {
          where: {
            related: {
              user: {
                some: (fn: (child: unknown) => unknown) => unknown;
              };
            };
          };
        };
      }
    ).where((model: unknown) => {
      const m = model as { id: { eq: (p: unknown) => unknown } };
      return m.id.eq(param('postId'));
    });
    const builderWithFilter = (
      builderWithWhere as {
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
    const plan = (
      builderWithFilter as { findMany: (options?: { params?: Record<string, unknown> }) => unknown }
    ).findMany({ params: { postId: 1, userId: 1 } });

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
    expect((plan as { ast: { kind: string } }).ast?.kind).toBe('select');
  });

  it('builds plan with where.related.none() filter', () => {
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
    const plan = (
      builderWithFilter as { findMany: (options?: { params?: Record<string, unknown> }) => unknown }
    ).findMany({ params: { postId: 1 } });

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
  });

  it('builds plan with where.related.every() filter', () => {
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
    const plan = (
      builderWithFilter as { findMany: (options?: { params?: Record<string, unknown> }) => unknown }
    ).findMany({ params: { title: 'test' } });

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
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

  it('throws error when model not found in mappings', () => {
    const invalidContract = {
      ...contract,
      mappings: {
        ...contract.mappings,
        modelToTable: {
          ...contract.mappings.modelToTable,
          Post: undefined as unknown as string,
        },
      },
    };
    const invalidContext = createTestContext(invalidContract, adapter);
    const invalidO = orm<Contract>({ context: invalidContext });
    const builder = (invalidO as unknown as { user: () => unknown }).user();

    expect(() => {
      (
        builder as {
          where: {
            related: {
              posts: {
                some: (fn: (child: unknown) => unknown) => unknown;
              };
            };
          };
        }
      ).where.related.posts.some(() => {
        throw new Error('Should not be called');
      });
    }).toThrow('Model Post not found in mappings');
  });

  it('throws error when table not found in schema', () => {
    const invalidContract = {
      ...contract,
      mappings: {
        ...contract.mappings,
        modelToTable: {
          ...contract.mappings.modelToTable,
          Post: 'nonexistent',
        },
      },
    };
    const invalidContext = createTestContext(invalidContract, adapter);
    const invalidO = orm<Contract>({ context: invalidContext });
    const builder = (invalidO as unknown as { user: () => unknown }).user();

    expect(() => {
      (
        builder as {
          where: {
            related: {
              posts: {
                some: (fn: (child: unknown) => unknown) => unknown;
              };
            };
          };
        }
      ).where.related.posts.some(() => {
        throw new Error('Should not be called');
      });
    }).toThrow('Table nonexistent not found in schema');
  });

  it('throws error when model does not have fields', () => {
    const invalidContract = {
      ...contract,
      models: {
        ...contract.models,
        Post: {
          storage: contract.models.Post.storage,
          relations: contract.models.Post.relations,
          // Omit fields property entirely
        } as typeof contract.models.Post,
      },
    };
    const invalidContext = createTestContext(invalidContract, adapter);
    const invalidO = orm<Contract>({ context: invalidContext });
    const builder = (invalidO as unknown as { user: () => unknown }).user();

    expect(() => {
      (
        builder as {
          where: {
            related: {
              posts: {
                some: (fn: (child: unknown) => unknown) => unknown;
              };
            };
          };
        }
      ).where.related.posts.some(() => {
        // This should not be called if error is thrown during construction
        return {} as unknown;
      });
    }).toThrow('Model Post does not have fields');
  });

  it('uses fieldName as fallback when fieldToColumn and field.column are missing', () => {
    const contractWithMissingMapping = {
      ...contract,
      mappings: {
        ...contract.mappings,
        fieldToColumn: {
          ...contract.mappings.fieldToColumn,
          Post: {},
        },
      },
      models: {
        ...contract.models,
        Post: {
          ...contract.models.Post,
          fields: {
            ...contract.models.Post.fields,
            title: {
              // Omit column property
            } as { column?: string },
          },
        },
      },
    };
    const contextWithMissingMapping = createTestContext(contractWithMissingMapping, adapter);
    const o = orm<Contract>({ context: contextWithMissingMapping });
    const builder = (o as unknown as { user: () => unknown }).user();

    // Should not throw - should use fieldName as fallback
    expect(() => {
      (
        builder as {
          where: {
            related: {
              posts: {
                some: (fn: (child: unknown) => unknown) => unknown;
              };
            };
          };
        }
      ).where.related.posts.some((child: unknown) => {
        const model = child as { title: { eq: (p: unknown) => unknown } };
        return model.title.eq(param('title'));
      });
    }).not.toThrow();
  });

  it('handles null field in model fields', () => {
    const contractWithNullField = {
      ...contract,
      models: {
        ...contract.models,
        Post: {
          ...contract.models.Post,
          fields: {
            ...contract.models.Post.fields,
            nullField: null as unknown as { column?: string },
          },
        },
      },
    };
    const contextWithNullField = createTestContext(contractWithNullField, adapter);
    const o = orm<Contract>({ context: contextWithNullField });
    const builder = (o as unknown as { user: () => unknown }).user();

    // Should not throw - should skip null field
    expect(() => {
      (
        builder as {
          where: {
            related: {
              posts: {
                some: (fn: (child: unknown) => unknown) => unknown;
              };
            };
          };
        }
      ).where.related.posts.some((child: unknown) => {
        const model = child as { id: { eq: (p: unknown) => unknown } };
        return model.id.eq(param('postId'));
      });
    }).not.toThrow();
  });

  it('combines main where clause with relation filter', () => {
    const builder = (o as unknown as { post: () => unknown }).post();
    const builderWithWhere = (
      builder as {
        where: (fn: (model: unknown) => unknown) => {
          where: {
            related: {
              user: {
                some: (fn: (child: unknown) => unknown) => unknown;
              };
            };
          };
        };
      }
    ).where((model: unknown) => {
      const m = model as { id: { eq: (p: unknown) => unknown } };
      return m.id.eq(param('postId'));
    });
    const builderWithFilter = (
      builderWithWhere as {
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
    const plan = (
      builderWithFilter as { findMany: (options?: { params?: Record<string, unknown> }) => unknown }
    ).findMany({ params: { postId: 1, userId: 1 } });

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
    expect((plan as { ast: { kind: string } }).ast?.kind).toBe('select');
  });

  it('combines multiple relation filters', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const builderWithFirstFilter = (
      builder as {
        where: {
          related: {
            posts: {
              some: (fn: (child: unknown) => unknown) => unknown;
            };
          };
        };
      }
    ).where.related.posts.some((child: unknown) => {
      const model = child as { id: { eq: (p: unknown) => unknown } };
      return model.id.eq(param('postId'));
    });
    const builderWithSecondFilter = (
      builderWithFirstFilter as {
        where: {
          related: {
            posts: {
              some: (fn: (child: unknown) => unknown) => unknown;
            };
          };
        };
      }
    ).where.related.posts.some((child: unknown) => {
      const model = child as { title: { eq: (p: unknown) => unknown } };
      return model.title.eq(param('title'));
    });
    const plan = (
      builderWithSecondFilter as {
        findMany: (options?: { params?: Record<string, unknown> }) => unknown;
      }
    ).findMany({ params: { postId: 1, title: 'test' } });

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
  });
});
