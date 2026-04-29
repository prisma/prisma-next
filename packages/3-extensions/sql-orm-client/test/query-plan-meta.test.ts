import {
  ColumnRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  buildOrmPlanMeta,
  buildOrmQueryPlan,
  deriveParamsFromAst,
  resolveTableColumns,
} from '../src/query-plan-meta';
import { baseContract } from './collection-fixtures';

describe('query plan meta', () => {
  it('resolves table columns and rejects unknown tables', () => {
    expect(resolveTableColumns(baseContract, 'users')).toEqual(
      Object.keys(baseContract.storage.tables.users.columns),
    );
    expect(() => resolveTableColumns(baseContract, 'missing')).toThrow(
      'Unknown table "missing" in SQL ORM query planner',
    );
  });

  it('includes profileHash in plan meta and carries no sidecars', () => {
    expect(buildOrmPlanMeta(baseContract)).toEqual({
      target: baseContract.target,
      targetFamily: baseContract.targetFamily,
      storageHash: baseContract.storage.storageHash,
      profileHash: baseContract.profileHash,
      lane: 'orm-client',
    });
  });

  it('produces a plan whose meta carries no execution-metadata sidecars', () => {
    const ast = SelectAst.from(TableSource.named('users'))
      .withProjection([
        ProjectionItem.of('id', ColumnRef.of('users', 'id'), 'pg/int4@1'),
        ProjectionItem.of('email', ColumnRef.of('users', 'email'), 'pg/text@1'),
      ])
      .withLimit(5);

    const { params } = deriveParamsFromAst(ast);
    const plan = buildOrmQueryPlan(baseContract, ast, params);

    expect(plan.meta).not.toHaveProperty('paramDescriptors');
    expect(plan.meta).not.toHaveProperty('projectionTypes');
    expect(plan.meta).not.toHaveProperty('refs');
    expect(plan.meta.annotations?.['codecs']).toBeUndefined();
  });

  it('codecIds for projections live on ProjectionItem, not the meta', () => {
    const ast = SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('users', 'id'), 'pg/int4@1'),
      ProjectionItem.of('email', ColumnRef.of('users', 'email'), 'pg/text@1'),
    ]);

    const plan = buildOrmQueryPlan(baseContract, ast, []);

    expect(plan.ast.kind).toBe('select');
    if (plan.ast.kind !== 'select') return;
    expect(plan.ast.projection.map((item) => [item.alias, item.codecId])).toEqual([
      ['id', 'pg/int4@1'],
      ['email', 'pg/text@1'],
    ]);
  });
});
