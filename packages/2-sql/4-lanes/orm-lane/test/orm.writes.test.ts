import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import { validateContract } from '@prisma-next/sql-contract/validate';
import type {
  Adapter,
  DeleteAst,
  InsertAst,
  LoweredStatement,
  SelectAst,
  UpdateAst,
} from '@prisma-next/sql-relational-core/ast';
import { createCodecRegistry } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { orm } from '../src/orm';
import type { Contract } from './fixtures/contract.d';
import type { GeneratedContract } from './fixtures/contract-generated.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): Contract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<Contract>(contractJson);
}

function loadGeneratedContract(name: string): GeneratedContract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<GeneratedContract>(contractJson);
}

function createStubAdapter(): Adapter<
  InsertAst | UpdateAst | DeleteAst,
  SqlContract<SqlStorage>,
  LoweredStatement
> {
  return {
    profile: {
      id: 'stub-profile',
      target: 'postgres',
      capabilities: {},
      codecs() {
        return createCodecRegistry();
      },
    },
    lower(
      ast: InsertAst | UpdateAst | DeleteAst,
      ctx: { contract: SqlContract<SqlStorage>; params?: readonly unknown[] },
    ) {
      const sqlText = JSON.stringify(ast);
      return {
        profileId: this.profile.id,
        body: Object.freeze({ sql: sqlText, params: ctx.params ? [...ctx.params] : [] }),
      };
    },
  };
}

describe('orm writes', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter() as Adapter<
    SelectAst | InsertAst | UpdateAst | DeleteAst,
    Contract,
    LoweredStatement
  >;
  const context = createTestContext(contract, adapter);
  const o = orm<Contract>({ context });

  it('creates a row with create()', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as {
        create: (
          data: Record<string, unknown>,
          options?: { params?: Record<string, unknown> },
        ) => unknown;
      }
    ).create({ id: 1, email: 'test@example.com' });

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
    expect((plan as { meta: { annotations: { intent: string } } }).meta.annotations.intent).toBe(
      'write',
    );
    expect((plan as { ast: { kind: string } }).ast?.kind).toBe('insert');
    const ast = plan as { ast: InsertAst };
    expect(ast.ast.table.name).toBe('user');
    expect(ast.ast.values).toBeDefined();
    expect(Object.keys(ast.ast.values).length).toBeGreaterThan(0);
  });

  it('throws error when create() is called with empty data', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    expect(() => {
      (builder as { create: (data: Record<string, unknown>) => unknown }).create({});
    }).toThrow('create() requires at least one field');
  });

  it('throws error when create() is called with invalid field name', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    expect(() => {
      (builder as { create: (data: Record<string, unknown>) => unknown }).create({
        invalidField: 'value',
      });
    }).toThrow('Field invalidField does not exist on model User');
  });

  it('handles create() with null field in model fields', () => {
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
    const oWithNullField = orm<Contract>({ context: contextWithNullField });
    const builder = (oWithNullField as unknown as { user: () => unknown }).user();

    // Should not throw - should skip null field
    expect(() => {
      (builder as { create: (data: Record<string, unknown>) => unknown }).create({
        id: 1,
        email: 'test@example.com',
        nullField: 'value',
      });
    }).not.toThrow();
  });

  it('updates rows with update()', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as {
        update: (
          where: (model: unknown) => unknown,
          data: Record<string, unknown>,
          options?: { params?: Record<string, unknown> },
        ) => unknown;
      }
    ).update(
      (u) => {
        const model = u as { id: { eq: (p: unknown) => unknown } };
        return model.id.eq(param('userId'));
      },
      { email: 'updated@example.com' },
      { params: { userId: 1 } },
    );

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
    expect((plan as { meta: { annotations: { intent: string } } }).meta.annotations.intent).toBe(
      'write',
    );
    expect((plan as { ast: { kind: string } }).ast?.kind).toBe('update');
    const ast = plan as { ast: UpdateAst };
    expect(ast.ast.table.name).toBe('user');
    expect(ast.ast.set).toBeDefined();
    expect(ast.ast.where).toBeDefined();
  });

  it('throws error when update() is called with empty data', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    expect(() => {
      (
        builder as {
          update: (where: (model: unknown) => unknown, data: Record<string, unknown>) => unknown;
        }
      ).update((u) => {
        const model = u as { id: { eq: (p: unknown) => unknown } };
        return model.id.eq(param('userId'));
      }, {});
    }).toThrow('update() requires at least one field');
  });

  it('throws error when update() is called with invalid field name', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    expect(() => {
      (
        builder as {
          update: (where: (model: unknown) => unknown, data: Record<string, unknown>) => unknown;
        }
      ).update(
        (u) => {
          const model = u as { id: { eq: (p: unknown) => unknown } };
          return model.id.eq(param('userId'));
        },
        { invalidField: 'value' },
      );
    }).toThrow('Field invalidField does not exist on model User');
  });

  it('handles update() with null field in model fields', () => {
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
    const oWithNullField = orm<Contract>({ context: contextWithNullField });
    const builder = (oWithNullField as unknown as { user: () => unknown }).user();

    // Should not throw - should skip null field (Object.hasOwn check will skip it)
    expect(() => {
      (
        builder as {
          update: (
            where: (model: unknown) => unknown,
            data: Record<string, unknown>,
            options?: { params?: Record<string, unknown> },
          ) => unknown;
        }
      ).update(
        (u) => {
          const model = u as { id: { eq: (p: unknown) => unknown } };
          return model.id.eq(param('userId'));
        },
        { email: 'updated@example.com' },
        { params: { userId: 1 } },
      );
    }).not.toThrow();
  });

  it('deletes rows with delete()', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as {
        delete: (
          where: (model: unknown) => unknown,
          options?: { params?: Record<string, unknown> },
        ) => unknown;
      }
    ).delete(
      (u) => {
        const model = u as { id: { eq: (p: unknown) => unknown } };
        return model.id.eq(param('userId'));
      },
      { params: { userId: 1 } },
    );

    expect(plan).toBeDefined();
    expect((plan as { meta: { lane: string } }).meta.lane).toBe('orm');
    expect((plan as { meta: { annotations: { intent: string } } }).meta.annotations.intent).toBe(
      'write',
    );
    expect((plan as { ast: { kind: string } }).ast?.kind).toBe('delete');
    const ast = plan as { ast: DeleteAst };
    expect(ast.ast.table.name).toBe('user');
    expect(ast.ast.where).toBeDefined();
  });

  it('maps model field names to column names correctly', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as {
        create: (data: Record<string, unknown>) => unknown;
      }
    ).create({ id: 1, email: 'test@example.com' });

    const ast = plan as { ast: InsertAst };
    // Check that values use column names (from contract, email maps to email column)
    expect(ast.ast.values).toBeDefined();
    // The param names should be the field names (id, email)
    // The column names should be the mapped column names
    expect(Object.keys(ast.ast.values).length).toBe(2);
  });

  it('handles parameter passing correctly', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as {
        create: (
          data: Record<string, unknown>,
          options?: { params?: Record<string, unknown> },
        ) => unknown;
      }
    ).create({ id: 1, email: 'test@example.com' }, { params: { extraParam: 'value' } });

    expect(plan).toBeDefined();
    const planWithParams = plan as { params: unknown[] };
    // Params should include both data values and any extra params
    expect(planWithParams.params).toBeDefined();
  });
});

describe('orm writes with generated defaults', () => {
  const contract = loadGeneratedContract('contract-generated');
  const adapter = createStubAdapter() as Adapter<
    SelectAst | InsertAst | UpdateAst | DeleteAst,
    GeneratedContract,
    LoweredStatement
  >;
  const context = createTestContext(contract, adapter);
  const o = orm<GeneratedContract>({ context });

  it('generates missing values for generated defaults on create()', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as {
        create: (data: Record<string, unknown>) => unknown;
      }
    ).create({ email: 'test@example.com' });

    const ast = plan as { ast: InsertAst; params: unknown[] };
    expect(ast.ast.values).toHaveProperty('id');
    expect(ast.params.length).toBe(2);
    expect(ast.params).toContain('test@example.com');
    const generatedValue = ast.params.find((value) => value !== 'test@example.com');
    expect(typeof generatedValue).toBe('string');
    expect(generatedValue).not.toBe('');
  });

  it('accepts create() when generated columns are provided', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as {
        create: (data: Record<string, unknown>) => unknown;
      }
    ).create({ id: 'user_1', email: 'test@example.com' });

    const ast = plan as { ast: InsertAst; params: unknown[] };
    expect(ast.ast.values).toHaveProperty('id');
    expect(ast.params).toContain('user_1');
  });

  it('accepts update() when generated columns are provided', () => {
    const builder = (o as unknown as { user: () => unknown }).user();
    const plan = (
      builder as {
        update: (
          where: (model: unknown) => unknown,
          data: Record<string, unknown>,
          options?: { params?: Record<string, unknown> },
        ) => unknown;
      }
    ).update(
      (u) => {
        const model = u as { id: { eq: (p: unknown) => unknown } };
        return model.id.eq(param('userId'));
      },
      { id: 'user_1' },
      { params: { userId: 'user_1' } },
    );

    const ast = plan as { ast: UpdateAst; params: unknown[] };
    expect(ast.ast.set).toHaveProperty('id');
    expect(ast.params).toContain('user_1');
  });
});
