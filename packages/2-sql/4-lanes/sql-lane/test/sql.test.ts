import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SelectAst } from '@prisma-next/sql-relational-core/ast';
import {
  BinaryExpr,
  ColumnRef,
  OrderByItem,
  ParamRef,
  ProjectionItem,
} from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type { ColumnBuilder } from '@prisma-next/sql-relational-core/types';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { CodecTypes, Contract } from './fixtures/contract.d';
import { createFixtureContext, loadFixtureContract } from './test-helpers';

describe('sql DSL builder', () => {
  const contract = loadFixtureContract<Contract>('contract');
  const context = createFixtureContext(contract);
  const tables = schema<Contract>(context).tables;

  it('builds a select plan with projection, where, order, and limit', () => {
    const plan = sql<Contract, CodecTypes>({ context })
      .from(tables.user)
      .select({
        id: tables.user.columns.id,
        email: tables.user.columns.email,
      })
      .where(tables.user.columns.id.eq(param('userId')))
      .orderBy(tables.user.columns.createdAt.desc())
      .limit(5)
      .build({ params: { userId: 42 } });

    expect(plan.ast.kind).toBe('select');
    const ast = plan.ast as SelectAst;
    expect(ast.projection).toEqual([
      ProjectionItem.of('id', ColumnRef.of('user', 'id')),
      ProjectionItem.of('email', ColumnRef.of('user', 'email')),
    ]);
    expect(ast.where).toEqual(
      BinaryExpr.eq(
        ColumnRef.of('user', 'id'),
        ParamRef.of(42, { name: 'userId', codecId: 'pg/int4@1', nativeType: 'int4' }),
      ),
    );
    expect(ast.orderBy).toEqual([OrderByItem.desc(ColumnRef.of('user', 'createdAt'))]);
    expect(ast.limit).toBe(5);
    expect(plan.params).toEqual([42]);
    expect(plan.meta).toMatchObject({
      target: 'postgres',
      storageHash: contract.storageHash,
      lane: 'dsl',
      refs: {
        tables: ['user'],
      },
      projection: {
        id: 'user.id',
        email: 'user.email',
      },
      annotations: {
        limit: 5,
      },
    });
    expect(plan.meta.paramDescriptors).toEqual<ParamDescriptor[]>([
      {
        name: 'userId',
        codecId: 'pg/int4@1',
        nativeType: 'int4',
        source: 'dsl',
      },
    ]);
  });

  it('throws for invalid projections and missing params', () => {
    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(tables.user)
        .select({ invalid: null as unknown as ColumnBuilder })
        .build(),
    ).toThrow(/Invalid projection value/);

    expect(() =>
      sql<Contract, CodecTypes>({ context })
        .from(tables.user)
        .select({ id: tables.user.columns.id })
        .where(tables.user.columns.id.eq(param('userId')))
        .build(),
    ).toThrow(/Missing value for parameter userId/);
  });

  it('emits codec annotations for projections and WHERE params', () => {
    const contractWithDecorations = loadFixtureContract<Contract>('contract');
    const decorated = {
      ...contractWithDecorations,
      extensionPacks: {
        postgres: {
          decorations: {
            columns: [
              {
                ref: { kind: 'column', table: 'user', column: 'id' },
                payload: { typeId: 'pg/int4@1' },
              },
              {
                ref: { kind: 'column', table: 'user', column: 'email' },
                payload: { typeId: 'pg/text@1' },
              },
            ],
          },
        },
      },
    } as Contract;
    const decoratedContext = createFixtureContext(decorated);
    const decoratedTables = schema<Contract>(decoratedContext).tables;

    const plan = sql<Contract, CodecTypes>({ context: decoratedContext })
      .from(decoratedTables.user)
      .select({
        id: decoratedTables.user.columns.id,
        email: decoratedTables.user.columns.email,
      })
      .where(decoratedTables.user.columns.id.eq(param('userId')))
      .build({ params: { userId: 42 } });

    expect(plan.meta.annotations?.codecs).toEqual({
      id: 'pg/int4@1',
      email: 'pg/text@1',
      userId: 'pg/int4@1',
    });
  });

  it('flattens nested projections and exposes table and column builders', () => {
    const plan = sql<Contract, CodecTypes>({ context })
      .from(tables.user)
      .select({
        user: {
          id: tables.user.columns.id,
          email: tables.user.columns.email,
        },
      })
      .build();

    expect((plan.ast as SelectAst).projection.map((item) => item.alias)).toEqual([
      'user_id',
      'user_email',
    ]);
    expect(tables.user.name).toBe('user');
    expect(tables.user.columns.id.toExpr()).toEqual(ColumnRef.of('user', 'id'));
  });
});
