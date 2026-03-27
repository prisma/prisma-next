import { validateContract } from '@prisma-next/sql-contract/validate';
import {
  AndExpr,
  BinaryExpr,
  type ColumnRef,
  DerivedTableSource,
  ExistsExpr,
  IdentifierRef,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import type { Runtime } from '@prisma-next/sql-runtime';
import { describe, expect, it } from 'vitest';
import { sql } from '../../src/runtime/sql';
import { contract as contractJson } from '../fixtures/contract';
import type { Contract } from '../fixtures/generated/contract';

// ---------------------------------------------------------------------------
// Fixture: real contract with users + posts
// ---------------------------------------------------------------------------

const sqlContract = validateContract<Contract>(contractJson);

const stubRuntime = { execute: () => (async function* () {})() } as unknown as Runtime;

const stubBase = {
  operations: {},
  codecs: {},
  queryOperations: { entries: () => ({}) },
  types: {},
  applyMutationDefaults: () => [],
};

function db() {
  return sql({
    context: { ...stubBase, contract: sqlContract } as unknown as ExecutionContext<
      typeof sqlContract
    >,
    runtime: stubRuntime,
  });
}

function dbNoCapabilities() {
  const noLateralContract = validateContract<Contract>({
    ...contractJson,
    capabilities: { sql: {}, postgres: {} },
  });
  return sql({
    context: { ...stubBase, contract: noLateralContract } as unknown as ExecutionContext<
      typeof noLateralContract
    >,
    runtime: stubRuntime,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getAst(builder: { buildAst(): SelectAst }): SelectAst {
  return builder.buildAst();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('sql', () => {
  it('exposes table proxies for all tables in contract', () => {
    const d = db();
    expect(d.users).toBeDefined();
    expect(d.posts).toBeDefined();
    expect((d as Record<string, unknown>)['nonexistent']).toBeUndefined();
  });
});

describe('TableProxy', () => {
  it('as() produces proxy with rebound alias', () => {
    const d = db();
    const u1 = d.users.as('u1');
    const ast = u1.buildAst() as TableSource;
    expect(ast).toBeInstanceOf(TableSource);
    expect(ast.name).toBe('users');
    expect(ast.alias).toBe('u1');
  });
});

describe('select', () => {
  it('select by column names produces ProjectionItems', () => {
    const ast = getAst(db().users.select('id', 'name'));
    expect(ast.projection).toHaveLength(2);
    expect(ast.projection[0]!.alias).toBe('id');
    expect(ast.projection[0]!.expr).toBeInstanceOf(IdentifierRef);
    expect((ast.projection[0]!.expr as IdentifierRef).name).toBe('id');
    expect(ast.projection[1]!.alias).toBe('name');
  });

  it('select with aliased expression', () => {
    const ast = getAst(db().users.select('upper_name', (f, _fns) => f.name));
    expect(ast.projection).toHaveLength(1);
    expect(ast.projection[0]!.alias).toBe('upper_name');
    expect(ast.projection[0]!.expr).toBeInstanceOf(IdentifierRef);
  });

  it('select with callback record', () => {
    const ast = getAst(db().users.select((f) => ({ myId: f.id, myName: f.name })));
    expect(ast.projection).toHaveLength(2);
    expect(ast.projection[0]!.alias).toBe('myId');
    expect(ast.projection[1]!.alias).toBe('myName');
  });

  it('chained select accumulates projections', () => {
    const ast = getAst(db().users.select('id').select('name'));
    expect(ast.projection).toHaveLength(2);
    expect(ast.projection[0]!.alias).toBe('id');
    expect(ast.projection[1]!.alias).toBe('name');
  });
});

describe('where', () => {
  it('single where produces BinaryExpr', () => {
    const ast = getAst(
      db()
        .users.select('id')
        .where((f, fns) => fns.eq(f.id, 1)),
    );
    expect(ast.where).toBeInstanceOf(BinaryExpr);
    expect((ast.where as BinaryExpr).op).toBe('eq');
  });

  it('multiple where calls produce AndExpr', () => {
    const ast = getAst(
      db()
        .users.select('id')
        .where((f, fns) => fns.eq(f.id, 1))
        .where((f, fns) => fns.gt(f.id, 0)),
    );
    expect(ast.where).toBeInstanceOf(AndExpr);
    expect((ast.where as AndExpr).exprs).toHaveLength(2);
  });
});

describe('immutability', () => {
  it('where does not mutate original builder', () => {
    const base = db().users.select('id');
    const filtered = base.where((f, fns) => fns.eq(f.id, 1));
    expect(getAst(base).where).toBeUndefined();
    expect(getAst(filtered).where).toBeDefined();
  });

  it('select does not mutate original builder', () => {
    const base = db().users.select('id');
    const extended = base.select('name');
    expect(getAst(base).projection).toHaveLength(1);
    expect(getAst(extended).projection).toHaveLength(2);
  });
});

describe('joins', () => {
  it('innerJoin produces JoinAst with inner type', () => {
    const ast = getAst(
      db()
        .users.innerJoin(db().posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
        .select('name', 'title'),
    );
    expect(ast.joins).toHaveLength(1);
    expect(ast.joins![0]!.joinType).toBe('inner');
    expect(ast.joins![0]!.source).toBeInstanceOf(TableSource);
    expect(ast.joins![0]!.on).toBeInstanceOf(BinaryExpr);
  });

  it('outerLeftJoin produces JoinAst with left type', () => {
    const ast = getAst(
      db()
        .users.outerLeftJoin(db().posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
        .select('name'),
    );
    expect(ast.joins![0]!.joinType).toBe('left');
  });

  it('outerRightJoin produces JoinAst with right type', () => {
    const ast = getAst(
      db()
        .users.outerRightJoin(db().posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
        .select('title'),
    );
    expect(ast.joins![0]!.joinType).toBe('right');
  });

  it('outerFullJoin produces JoinAst with full type', () => {
    const ast = getAst(
      db()
        .users.outerFullJoin(db().posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
        .select((f) => ({ name: f.users.name })),
    );
    expect(ast.joins![0]!.joinType).toBe('full');
  });

  it('join on expression references columns from both sides', () => {
    const ast = getAst(
      db()
        .users.innerJoin(db().posts, (f, fns) => fns.eq(f.users.id, f.posts.user_id))
        .select('name'),
    );
    const on = ast.joins![0]!.on as BinaryExpr;
    const left = on.left as ColumnRef;
    const right = on.right as ColumnRef;
    expect(left.table).toBe('users');
    expect(left.column).toBe('id');
    expect(right.table).toBe('posts');
    expect(right.column).toBe('user_id');
  });
});

describe('self-join via as()', () => {
  it('self-join with aliased tables', () => {
    const d = db();
    const u1 = d.users.as('u1');
    const u2 = d.users.as('u2');
    const ast = getAst(
      u1
        .innerJoin(u2, (f, fns) => fns.eq(f.u1.id, f.u2.invited_by_id))
        .select((f) => ({ inviter: f.u1.name, invitee: f.u2.name })),
    );
    expect(ast.from).toBeInstanceOf(TableSource);
    expect((ast.from as TableSource).alias).toBe('u1');
    expect(ast.joins).toHaveLength(1);
    expect((ast.joins![0]!.source as TableSource).alias).toBe('u2');
  });
});

describe('orderBy', () => {
  it('orderBy string with desc direction', () => {
    const ast = getAst(db().users.select('id', 'name').orderBy('name', { direction: 'desc' }));
    expect(ast.orderBy).toHaveLength(1);
    expect(ast.orderBy![0]!.dir).toBe('desc');
    expect(ast.orderBy![0]!.expr).toBeInstanceOf(IdentifierRef);
    expect((ast.orderBy![0]!.expr as IdentifierRef).name).toBe('name');
  });

  it('orderBy defaults to asc', () => {
    const ast = getAst(db().users.select('id').orderBy('id'));
    expect(ast.orderBy![0]!.dir).toBe('asc');
  });

  it('orderBy with expression callback', () => {
    const ast = getAst(
      db()
        .users.select('id')
        .orderBy((f) => f.id),
    );
    expect(ast.orderBy).toHaveLength(1);
    expect(ast.orderBy![0]!.expr).toBeInstanceOf(IdentifierRef);
  });

  it('multiple orderBy calls accumulate', () => {
    const ast = getAst(
      db().users.select('id', 'name').orderBy('id').orderBy('name', { direction: 'desc' }),
    );
    expect(ast.orderBy).toHaveLength(2);
  });
});

describe('groupBy and having', () => {
  it('groupBy transitions builder and produces groupBy on AST', () => {
    const ast = getAst(db().posts.select('user_id').groupBy('user_id'));
    expect(ast.groupBy).toHaveLength(1);
    expect(ast.groupBy![0]).toBeInstanceOf(IdentifierRef);
    expect((ast.groupBy![0] as IdentifierRef).name).toBe('user_id');
  });

  it('having adds HAVING clause', () => {
    const ast = getAst(
      db()
        .posts.select('user_id')
        .select('cnt', (_f, fns) => fns.count())
        .groupBy('user_id')
        .having((_f, fns) => fns.gt(fns.count(), 1)),
    );
    expect(ast.having).toBeDefined();
    expect(ast.having).toBeInstanceOf(BinaryExpr);
  });

  it('groupBy with expression callback', () => {
    const ast = getAst(
      db()
        .posts.select('user_id')
        .groupBy((f) => f.user_id),
    );
    expect(ast.groupBy).toHaveLength(1);
  });
});

describe('limit and offset', () => {
  it('limit sets limit on AST', () => {
    const ast = getAst(db().users.select('id').limit(10));
    expect(ast.limit).toBe(10);
  });

  it('offset sets offset on AST', () => {
    const ast = getAst(db().users.select('id').offset(5));
    expect(ast.offset).toBe(5);
  });

  it('limit and offset together', () => {
    const ast = getAst(db().users.select('id').limit(10).offset(5));
    expect(ast.limit).toBe(10);
    expect(ast.offset).toBe(5);
  });
});

describe('distinct', () => {
  it('distinct sets distinct on AST', () => {
    const ast = getAst(db().users.select('id').distinct());
    expect(ast.distinct).toBe(true);
  });

  it('distinctOn sets distinctOn on AST', () => {
    const ast = getAst(db().users.select('id', 'name').distinctOn('id'));
    expect(ast.distinctOn).toHaveLength(1);
    expect(ast.distinctOn![0]).toBeInstanceOf(IdentifierRef);
  });

  it('distinctOn throws without capability', () => {
    const query = dbNoCapabilities().users.select('id') as unknown as {
      distinctOn(s: string): void;
    };
    expect(() => query.distinctOn('id')).toThrow(
      'distinctOn() requires capability postgres.distinctOn',
    );
  });
});

describe('lateral joins', () => {
  it('lateralJoin produces lateral JoinAst with DerivedTableSource', () => {
    const d = db();
    const ast = getAst(
      d.users
        .lateralJoin('recent_posts', (lateral) =>
          lateral
            .from(d.posts)
            .select('title')
            .where((f, fns) => fns.eq(f.posts.user_id, f.users.id))
            .limit(3),
        )
        .select('name', 'title'),
    );
    expect(ast.joins).toHaveLength(1);
    expect(ast.joins![0]!.lateral).toBe(true);
    expect(ast.joins![0]!.source).toBeInstanceOf(DerivedTableSource);
    expect((ast.joins![0]!.source as DerivedTableSource).alias).toBe('recent_posts');
  });

  it('lateralJoin throws without capability', () => {
    const d = dbNoCapabilities();
    const users = d.users as unknown as { lateralJoin(alias: string, fn: unknown): void };
    expect(() =>
      users.lateralJoin(
        'x',
        (lateral: { from(t: unknown): { select(...args: string[]): unknown } }) =>
          lateral.from(d.posts).select('id'),
      ),
    ).toThrow('lateralJoin() requires capability sql.lateral');
  });
});

describe('subquery as join source', () => {
  it('select query .as() produces JoinSource backed by DerivedTableSource', () => {
    const sub = db().posts.select('user_id').as('sub');
    const source = sub.buildAst() as DerivedTableSource;
    expect(source).toBeInstanceOf(DerivedTableSource);
    expect(source.alias).toBe('sub');
  });

  it('subquery can be used in innerJoin', () => {
    const d = db();
    const sub = d.posts.select('user_id').as('sub');
    const ast = getAst(
      d.users.innerJoin(sub, (f, fns) => fns.eq(f.users.id, f.sub.user_id)).select('name'),
    );
    expect(ast.joins).toHaveLength(1);
    expect(ast.joins![0]!.source).toBeInstanceOf(DerivedTableSource);
  });
});

describe('subquery in exists/in', () => {
  it('subquery implements buildAst for exists()', () => {
    const d = db();
    const sub = d.posts.select('id');
    // sub should have buildAst() for Subquery interface
    const ast = sub.buildAst();
    expect(ast).toBeInstanceOf(SelectAst);
  });

  it('subquery used in where with exists', () => {
    const d = db();
    const ast = getAst(
      d.users
        .select('id')
        .where((f, fns) =>
          fns.exists(d.posts.select('id').where((pf, pfns) => pfns.eq(pf.user_id, f.id))),
        ),
    );
    expect(ast.where).toBeInstanceOf(ExistsExpr);
  });
});

describe('grouped query methods', () => {
  it('grouped query supports orderBy', () => {
    const ast = getAst(
      db().posts.select('user_id').groupBy('user_id').orderBy('user_id', { direction: 'desc' }),
    );
    expect(ast.orderBy).toHaveLength(1);
    expect(ast.orderBy![0]!.dir).toBe('desc');
  });

  it('grouped query supports limit/offset', () => {
    const ast = getAst(db().posts.select('user_id').groupBy('user_id').limit(5).offset(10));
    expect(ast.limit).toBe(5);
    expect(ast.offset).toBe(10);
  });

  it('grouped query supports distinct', () => {
    const ast = getAst(db().posts.select('user_id').groupBy('user_id').distinct());
    expect(ast.distinct).toBe(true);
  });

  it('grouped query supports as() for subquery', () => {
    const sub = db().posts.select('user_id').groupBy('user_id').as('grouped');
    const source = sub.buildAst() as DerivedTableSource;
    expect(source).toBeInstanceOf(DerivedTableSource);
    expect(source.alias).toBe('grouped');
  });

  it('grouped query supports chained groupBy', () => {
    const ast = getAst(db().posts.select('user_id', 'views').groupBy('user_id').groupBy('views'));
    expect(ast.groupBy).toHaveLength(2);
  });
});
