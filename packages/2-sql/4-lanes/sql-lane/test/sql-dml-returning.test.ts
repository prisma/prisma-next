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
import { createCodecRegistry, createColumnRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { Contract } from './fixtures/contract.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadContract(name: string): Contract {
  const filePath = join(fixtureDir, `${name}.json`);
  const contents = readFileSync(filePath, 'utf8');
  const contractJson = JSON.parse(contents);
  return validateContract<Contract>(contractJson);
}

function createStubAdapter(): Adapter<
  SelectAst | InsertAst | UpdateAst | DeleteAst,
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
      ast: SelectAst | InsertAst | UpdateAst | DeleteAst,
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

describe('returning() capability gating', () => {
  const contract = loadContract('contract');
  const adapter = createStubAdapter();
  const context = createTestContext(contract, adapter);
  const tables = schema<Contract>(context).tables;
  const userColumns = tables.user.columns;

  it('throws error when returning capability is missing', () => {
    const contractWithoutReturning = {
      ...contract,
      capabilities: {
        postgres: {
          orderBy: true,
          limit: true,
        },
      },
    };

    const contextWithoutReturning = createTestContext(
      contractWithoutReturning as Contract,
      adapter,
    );
    expect(() => {
      sql<Contract>({ context: contextWithoutReturning })
        .insert(tables.user, {
          email: param('email'),
        })
        .returning(userColumns.id, userColumns.email);
    }).toThrow('returning() requires returning capability');
  });

  it('throws error when returning capability is false', () => {
    const contractWithReturningFalse = {
      ...contract,
      capabilities: {
        postgres: {
          orderBy: true,
          limit: true,
          returning: false,
        },
      },
    };

    const contextWithReturningFalse = createTestContext(
      contractWithReturningFalse as Contract,
      adapter,
    );
    expect(() => {
      sql<Contract>({ context: contextWithReturningFalse })
        .insert(tables.user, {
          email: param('email'),
        })
        .returning(userColumns.id, userColumns.email);
    }).toThrow('returning() requires returning capability to be true');
  });

  it('works when returning capability is true', () => {
    const contractWithReturning = {
      ...contract,
      capabilities: {
        postgres: {
          orderBy: true,
          limit: true,
          returning: true,
        },
      },
    };

    const contextWithReturning = createTestContext(contractWithReturning as Contract, adapter);
    const plan = sql<Contract>({ context: contextWithReturning })
      .insert(tables.user, {
        email: param('email'),
      })
      .returning(userColumns.id, userColumns.email)
      .build({ params: { email: 'test@example.com' } });

    expect(plan.ast).toMatchObject({
      kind: 'insert',
      returning: [createColumnRef('user', 'id'), createColumnRef('user', 'email')],
    });
  });

  it('throws error for update when returning capability is missing', () => {
    const contractWithoutReturning = {
      ...contract,
      capabilities: {
        postgres: {
          orderBy: true,
          limit: true,
        },
      },
    };

    const contextWithoutReturning = createTestContext(
      contractWithoutReturning as Contract,
      adapter,
    );
    expect(() => {
      sql<Contract>({ context: contextWithoutReturning })
        .update(tables.user, {
          email: param('newEmail'),
        })
        .where(userColumns.id.eq(param('userId')))
        .returning(userColumns.id, userColumns.email);
    }).toThrow('returning() requires returning capability');
  });

  it('throws error for delete when returning capability is missing', () => {
    const contractWithoutReturning = {
      ...contract,
      capabilities: {
        postgres: {
          orderBy: true,
          limit: true,
        },
      },
    };

    const contextWithoutReturning = createTestContext(
      contractWithoutReturning as Contract,
      adapter,
    );
    expect(() => {
      sql<Contract>({ context: contextWithoutReturning })
        .delete(tables.user)
        .where(userColumns.id.eq(param('userId')))
        .returning(userColumns.id, userColumns.email);
    }).toThrow('returning() requires returning capability');
  });
});
