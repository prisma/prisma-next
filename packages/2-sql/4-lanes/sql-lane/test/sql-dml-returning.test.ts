import type { InsertAst } from '@prisma-next/sql-relational-core/ast';
import { ColumnRef } from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { Contract } from './fixtures/contract.d';
import { createFixtureContext, loadFixtureContract } from './test-helpers';

describe('returning() capability gating', () => {
  const contract = loadFixtureContract<Contract>('contract');
  const baseContext = createFixtureContext(contract);
  const tables = schema<Contract>(baseContext).tables;

  it('throws when returning capability is missing or false', () => {
    const withoutReturning = {
      ...contract,
      capabilities: {
        postgres: {
          orderBy: true,
          limit: true,
        },
      },
    } as Contract;
    const returningFalse = {
      ...contract,
      capabilities: {
        postgres: {
          orderBy: true,
          limit: true,
          returning: false,
        },
      },
    } as Contract;

    expect(() =>
      sql<Contract>({ context: createFixtureContext(withoutReturning) })
        .insert(tables.user, { email: param('email') })
        .returning(tables.user.columns.id, tables.user.columns.email),
    ).toThrow('returning() requires returning capability');

    expect(() =>
      sql<Contract>({ context: createFixtureContext(returningFalse) })
        .insert(tables.user, { email: param('email') })
        .returning(tables.user.columns.id, tables.user.columns.email),
    ).toThrow('returning() requires returning capability to be true');
  });

  it('builds returning clauses when the capability is enabled', () => {
    const returningContract = {
      ...contract,
      capabilities: {
        postgres: {
          orderBy: true,
          limit: true,
          returning: true,
        },
      },
    } as Contract;
    const context = createFixtureContext(returningContract);

    const insertPlan = sql<Contract>({ context })
      .insert(tables.user, { email: param('email') })
      .returning(tables.user.columns.id, tables.user.columns.email)
      .build({ params: { email: 'test@example.com' } });

    expect(insertPlan.ast.kind).toBe('insert');
    expect((insertPlan.ast as InsertAst).returning).toEqual([
      ColumnRef.of('user', 'id'),
      ColumnRef.of('user', 'email'),
    ]);
  });

  it('gates returning on update and delete builders too', () => {
    const withoutReturning = {
      ...contract,
      capabilities: {
        postgres: {
          orderBy: true,
          limit: true,
        },
      },
    } as Contract;
    const context = createFixtureContext(withoutReturning);

    expect(() =>
      sql<Contract>({ context })
        .update(tables.user, { email: param('newEmail') })
        .where(tables.user.columns.id.eq(param('userId')))
        .returning(tables.user.columns.id, tables.user.columns.email),
    ).toThrow('returning() requires returning capability');

    expect(() =>
      sql<Contract>({ context })
        .delete(tables.user)
        .where(tables.user.columns.id.eq(param('userId')))
        .returning(tables.user.columns.id, tables.user.columns.email),
    ).toThrow('returning() requires returning capability');
  });
});
