import {
  AndExpr,
  BinaryExpr,
  ColumnRef,
  DerivedTableSource,
  JoinAst,
  JsonArrayAggExpr,
  ParamRef,
} from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { describe, expect, it } from 'vitest';
import { buildIncludeJoinArtifact, IncludeChildBuilderImpl } from '../src/sql/include-builder';
import type { Contract } from './fixtures/contract.d';
import { createFixtureContext, loadFixtureContract } from './test-helpers';

describe('IncludeChildBuilderImpl', () => {
  const contract = loadFixtureContract<Contract>('contract');
  const context = createFixtureContext(contract);
  const tables = schema<Contract>(context).tables;

  it('requires child projection before getState', () => {
    const builder = new IncludeChildBuilderImpl(contract, { name: 'user' });
    expect(() => builder.getState()).toThrow('Child projection must be specified');
  });

  it('preserves where, orderBy, and limit across immutable chaining', () => {
    const builder = new IncludeChildBuilderImpl(contract, { name: 'user' })
      .where(tables.user.columns.id.eq(param('userId')))
      .orderBy(tables.user.columns.id.asc())
      .limit(10)
      .select({ id: tables.user.columns.id });

    const state = builder.getState();

    expect(state.childProjection.aliases).toEqual(['id']);
    expect(state.childWhere).toEqual(tables.user.columns.id.eq(param('userId')));
    expect(state.childOrderBy?.dir).toBe('asc');
    expect(state.childLimit).toBe(10);
  });

  it('preserves projection, orderBy, and limit when chaining where() after select()', () => {
    const state = new IncludeChildBuilderImpl(contract, { name: 'user' })
      .select({ id: tables.user.columns.id })
      .limit(3)
      .orderBy(tables.user.columns.email.desc())
      .where(tables.user.columns.email.eq(param('email')))
      .getState();

    expect(state.childProjection.aliases).toEqual(['id']);
    expect(state.childWhere).toEqual(tables.user.columns.email.eq(param('email')));
    expect(state.childOrderBy?.dir).toBe('desc');
    expect(state.childLimit).toBe(3);
  });

  it('validates include limits', () => {
    const builder = new IncludeChildBuilderImpl(contract, { name: 'user' }).select({
      id: tables.user.columns.id,
    });

    expect(() => builder.limit(-1)).toThrow('Limit must be a non-negative integer');
    expect(() => builder.limit(1.5)).toThrow('Limit must be a non-negative integer');
  });
});

describe('buildIncludeJoinArtifact', () => {
  const contract = loadFixtureContract<Contract>('contract');
  const context = createFixtureContext(contract);
  const tables = schema<Contract>(context).tables;

  it('builds a lateral derived-table join with aggregated JSON projection', () => {
    const includeState = {
      alias: 'posts',
      table: { name: 'post' },
      on: {
        kind: 'join-on' as const,
        left: tables.user.columns.id,
        right: tables.user.columns.id,
      },
      childProjection: {
        aliases: ['id'],
        columns: [tables.user.columns.id],
      },
      childWhere: tables.user.columns.id.eq(param('userId')),
      childOrderBy: tables.user.columns.id.asc(),
      childLimit: 10,
    };

    const artifact = buildIncludeJoinArtifact(includeState, contract, { userId: 42 }, [], []);

    expect(artifact.join).toBeInstanceOf(JoinAst);
    expect(artifact.join.lateral).toBe(true);
    expect(artifact.join.source).toBeInstanceOf(DerivedTableSource);
    expect(artifact.projection.expr).toEqual(ColumnRef.of('posts_lateral', 'posts'));

    const aggregateSelect = (artifact.join.source as DerivedTableSource).query;
    expect(aggregateSelect.projection[0]?.expr).toBeInstanceOf(JsonArrayAggExpr);
    expect(aggregateSelect.from).toBeInstanceOf(DerivedTableSource);
    const rowsQuery = (aggregateSelect.from as DerivedTableSource).query;
    expect(rowsQuery.where).toEqual(
      AndExpr.of([
        BinaryExpr.eq(ColumnRef.of('user', 'id'), ColumnRef.of('user', 'id')),
        BinaryExpr.eq(ColumnRef.of('user', 'id'), ParamRef.of(1, 'userId')),
      ]),
    );
    expect(rowsQuery.limit).toBe(10);
  });
});
