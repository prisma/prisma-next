import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RuntimeContext } from '@prisma-next/runtime';
import { validateContract } from '@prisma-next/sql-contract-ts/contract';
import { param } from '@prisma-next/sql-relational-core/param';
import type {
  Adapter,
  LoweredStatement,
  SelectAst,
  SqlContract,
  SqlStorage,
} from '@prisma-next/sql-target';
import { createCodecRegistry } from '@prisma-next/sql-target';
import { describe, expect, it } from 'vitest';
import { createTestContext } from '../../../../runtime/test/utils';
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

function createOrmWithContext<TContract extends SqlContract<SqlStorage>>(
  context: RuntimeContext<SqlContract<SqlStorage>>,
): ReturnType<typeof orm<TContract>> {
  return orm<TContract>({ context: context as unknown as RuntimeContext<TContract> });
}

describe('orm base builder', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const o = orm<Contract>({ context });

  it('chains where clause', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
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
    const builder = (o as unknown as { user: () => unknown }).user();
    const builderWithOrder = (
      builder as { orderBy: (fn: (m: unknown) => unknown) => unknown }
    ).orderBy((m: unknown) => {
      const model = m as { createdAt: { desc: () => unknown } };
      return model.createdAt.desc();
    });

    expect(builderWithOrder).toBeDefined();
  });

  it('chains take limit', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const builderWithLimit = (builder as { take: (n: number) => unknown }).take(10);

    expect(builderWithLimit).toBeDefined();
  });

  it('chains skip offset', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const builderWithSkip = (builder as { skip: (n: number) => unknown }).skip(5);

    expect(builderWithSkip).toBeDefined();
  });

  it('chains select projection', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const builderWithSelect = (
      builder as { select: (fn: (m: unknown) => unknown) => unknown }
    ).select((m: unknown) => {
      const model = m as { id: unknown; email: unknown };
      return { id: model.id, email: model.email };
    });

    expect(builderWithSelect).toBeDefined();
  });

  it('builds plan with findMany', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as { findMany: (options?: { params?: Record<string, unknown> }) => unknown }
    ).findMany({ params: {} });

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
    expect((plan as { ast: { kind: string } }).ast?.kind).toBe('select');
  });

  it('builds plan with findFirst', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as { findFirst: (options?: { params?: Record<string, unknown> }) => unknown }
    ).findFirst({ params: {} });

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
    expect((plan as { ast: { limit: number } }).ast?.limit).toBe(1);
  });

  it('builds plan with findUnique', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
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

  it('uses fieldName as fallback when fieldToColumn and field.column are missing', () => {
    const contractWithMissingMapping = {
      ...contract,
      mappings: {
        ...contract.mappings,
        fieldToColumn: {
          ...contract.mappings.fieldToColumn,
          User: {},
        },
      },
      models: {
        ...contract.models,
        User: {
          ...contract.models.User,
          fields: {
            ...contract.models.User.fields,
            email: {
              // Omit column property
            } as { column?: string },
          },
        },
      },
    };
    const contextWithMissingMapping = createTestContext(contractWithMissingMapping, adapter);
    const o = createOrmWithContext<Contract>(contextWithMissingMapping);
    const builder = (o as unknown as { user: () => unknown }).user();

    // Should not throw - should use fieldName as fallback
    expect(() => {
      (
        builder as {
          where: (fn: (m: unknown) => unknown) => unknown;
        }
      ).where((m: unknown) => {
        const model = m as { email: { eq: (p: unknown) => unknown } };
        return model.email.eq(param('email'));
      });
    }).not.toThrow();
  });

  it('handles null field in model fields', () => {
    const contractWithNullField = {
      ...contract,
      models: {
        ...contract.models,
        User: {
          ...contract.models.User,
          fields: {
            ...contract.models.User.fields,
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
          where: (fn: (m: unknown) => unknown) => unknown;
        }
      ).where((m: unknown) => {
        const model = m as { id: { eq: (p: unknown) => unknown } };
        return model.id.eq(param('userId'));
      });
    }).not.toThrow();
  });

  it('throws error when model is not found in mappings', () => {
    const contractWithMissingModel = {
      ...contract,
      mappings: {
        ...contract.mappings,
        modelToTable: {
          ...contract.mappings.modelToTable,
          User: undefined,
        },
      },
    };
    const contextWithMissingModel = createTestContext(
      contractWithMissingModel as unknown as SqlContract<SqlStorage>,
      adapter,
    );
    const o = createOrmWithContext<Contract>(contextWithMissingModel);

    expect(() => {
      (o as unknown as { user: () => unknown }).user();
    }).toThrow('Model User not found in mappings');
  });

  it('throws error when table is not found in schema', () => {
    const contractWithMissingTable = {
      ...contract,
      mappings: {
        ...contract.mappings,
        modelToTable: {
          ...contract.mappings.modelToTable,
          User: 'nonexistent',
        },
      },
    };
    const contextWithMissingTable = createTestContext(contractWithMissingTable, adapter);
    const o = createOrmWithContext<Contract>(contextWithMissingTable);

    expect(() => {
      (o as unknown as { user: () => unknown }).user();
    }).toThrow('Table nonexistent not found in schema');
  });

  it('throws error when model does not have fields property', () => {
    const contractWithMissingFields = {
      ...contract,
      models: {
        ...contract.models,
        User: {
          storage: contract.models.User.storage,
          relations: contract.models.User.relations,
          // Omit fields property entirely
        } as typeof contract.models.User,
      },
    };
    const contextWithMissingFields = createTestContext(contractWithMissingFields, adapter);
    const o = orm<Contract>({ context: contextWithMissingFields });
    const builder = (o as unknown as { user: () => unknown }).user();

    expect(() => {
      (
        builder as {
          where: (fn: (m: unknown) => unknown) => unknown;
        }
      ).where((m: unknown) => {
        const model = m as { id: { eq: (p: unknown) => unknown } };
        return model.id.eq(param('userId'));
      });
    }).toThrow('Model User does not have fields');
  });

  it('handles field mapping to non-existent column', () => {
    const contractWithNonExistentColumn = {
      ...contract,
      models: {
        ...contract.models,
        User: {
          ...contract.models.User,
          fields: {
            ...contract.models.User.fields,
            nonExistentField: {
              column: 'nonExistentColumn',
            } as { column?: string },
          },
        },
      },
    };
    const contextWithNonExistentColumn = createTestContext(contractWithNonExistentColumn, adapter);
    const o = orm<Contract>({ context: contextWithNonExistentColumn });
    const builder = (o as unknown as { user: () => unknown }).user();

    // Should not throw - field should not be in accessor if column doesn't exist
    expect(() => {
      (
        builder as {
          where: (fn: (m: unknown) => unknown) => unknown;
        }
      ).where((m: unknown) => {
        const model = m as { id: { eq: (p: unknown) => unknown } };
        return model.id.eq(param('userId'));
      });
    }).not.toThrow();
  });

  it('handles field mapping with fieldToColumn taking precedence over field.column', () => {
    const contractWithBothMappings = {
      ...contract,
      mappings: {
        ...contract.mappings,
        fieldToColumn: {
          ...contract.mappings.fieldToColumn,
          User: {
            ...contract.mappings.fieldToColumn?.User,
            email: 'email',
          },
        },
      },
      models: {
        ...contract.models,
        User: {
          ...contract.models.User,
          fields: {
            ...contract.models.User.fields,
            email: {
              column: 'email_address',
            } as { column?: string },
          },
        },
      },
    };
    const contextWithBothMappings = createTestContext(contractWithBothMappings, adapter);
    const o = createOrmWithContext<Contract>(contextWithBothMappings);
    const builder = (o as unknown as { user: () => unknown }).user();

    // Should not throw - fieldToColumn should take precedence
    expect(() => {
      (
        builder as {
          where: (fn: (m: unknown) => unknown) => unknown;
        }
      ).where((m: unknown) => {
        const model = m as { email: { eq: (p: unknown) => unknown } };
        return model.email.eq(param('email'));
      });
    }).not.toThrow();
  });

  it('returns empty include accessor when relations are missing', () => {
    const contractWithNoRelations = {
      ...contract,
      relations: {},
    };
    const contextWithNoRelations = createTestContext(contractWithNoRelations, adapter);
    const o = orm<Contract>({ context: contextWithNoRelations });
    const builder = (o as unknown as { user: () => unknown }).user();

    // Include should be empty object when relations are missing
    const include = (builder as { include: unknown }).include;
    expect(include).toEqual({});
  });

  it('returns empty related accessor when relations are missing', () => {
    const contractWithNoRelations = {
      ...contract,
      relations: {},
    };
    const contextWithNoRelations = createTestContext(contractWithNoRelations, adapter);
    const o = orm<Contract>({ context: contextWithNoRelations });
    const builder = (o as unknown as { user: () => unknown }).user();

    // Related should be empty object when relations are missing
    const where = (builder as { where: unknown }).where;
    const related = (where as { related: unknown }).related;
    expect(related).toEqual({});
  });
});
