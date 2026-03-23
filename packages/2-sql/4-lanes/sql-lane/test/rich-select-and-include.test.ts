import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  BinaryExpr,
  ColumnRef,
  DerivedTableSource,
  JoinAst,
  JsonArrayAggExpr,
  ParamRef,
  SelectAst,
} from '@prisma-next/sql-relational-core/ast';
import { param } from '@prisma-next/sql-relational-core/param';
import { schema } from '@prisma-next/sql-relational-core/schema';
import { createStubAdapter, createTestContext } from '@prisma-next/sql-runtime/test/utils';
import { describe, expect, it } from 'vitest';
import { sql } from '../src/sql/builder';
import type { CodecTypes as BaseCodecTypes, Contract as BaseContract } from './fixtures/contract.d';
import type {
  CodecTypes as RelationCodecTypes,
  Contract as RelationContract,
} from './fixtures/contract-with-relations.d';

const fixtureDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

function loadBaseContract(): BaseContract {
  return validateContract<BaseContract>(
    JSON.parse(readFileSync(join(fixtureDir, 'contract.json'), 'utf8')),
  );
}

function loadRelationContract(): RelationContract {
  return validateContract<RelationContract>(
    JSON.parse(readFileSync(join(fixtureDir, 'contract-with-relations.json'), 'utf8')),
  );
}

describe('sql lane rich select and include ASTs', () => {
  it('builds select plans with class-based AST nodes and limit annotations', () => {
    const contract = loadBaseContract();
    const context = createTestContext(contract, createStubAdapter());
    const tables = schema<BaseContract>(context).tables;

    const plan = sql<BaseContract, BaseCodecTypes>({ context })
      .from(tables.user)
      .where(tables.user.columns.id.eq(param('userId')))
      .select({
        user: {
          id: tables.user.columns.id,
          email: tables.user.columns.email,
        },
      })
      .orderBy(tables.user.columns.email.desc())
      .limit(5)
      .build({ params: { userId: 'u1' } });

    expect(plan.ast).toBeInstanceOf(SelectAst);
    const ast = plan.ast as SelectAst;
    expect(ast.projection.map((item) => item.alias)).toEqual(['user_id', 'user_email']);
    expect(plan.meta.projection).toEqual({
      user_id: 'user.id',
      user_email: 'user.email',
    });
    expect(plan.meta.annotations).toMatchObject({ limit: 5 });
    expect(ast.orderBy?.[0]?.expr).toEqual(ColumnRef.of('user', 'email'));
    expect(ast.where).toBeInstanceOf(BinaryExpr);
    expect((ast.where as BinaryExpr).right).toEqual(ParamRef.of(1, 'userId'));
  });

  it('builds includeMany using derived-table rich AST nodes', () => {
    const contract = loadRelationContract();
    const context = createTestContext(contract, createStubAdapter());
    const tables = schema<RelationContract>(context).tables;

    const plan = sql<RelationContract, RelationCodecTypes>({ context })
      .from(tables.user)
      .includeMany(
        tables.post,
        (on) => on.eqCol(tables.user.columns.id, tables.post.columns.userId),
        (child) =>
          child
            .select({
              id: tables.post.columns.id,
              title: tables.post.columns.title,
            })
            .orderBy(tables.post.columns.createdAt.desc())
            .limit(2),
        { alias: 'posts' },
      )
      .select({
        id: tables.user.columns.id,
        posts: true,
      })
      .build();

    expect(plan.ast).toBeInstanceOf(SelectAst);
    const ast = plan.ast as SelectAst;
    expect(ast.joins?.[0]).toBeInstanceOf(JoinAst);
    expect(ast.projection[1]?.expr).toEqual(ColumnRef.of('posts_lateral', 'posts'));

    const aggregateSource = ast.joins?.[0]?.source;
    expect(aggregateSource).toBeInstanceOf(DerivedTableSource);
    const aggregateSelect = (aggregateSource as DerivedTableSource).query;
    expect(aggregateSelect.projection[0]?.expr).toBeInstanceOf(JsonArrayAggExpr);
    expect(aggregateSelect.from).toBeInstanceOf(DerivedTableSource);
    expect((aggregateSelect.from as DerivedTableSource).query.limit).toBe(2);
    expect(plan.meta.refs?.tables).toContain('post');
  });
});
