import {
  ColumnRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { buildOrmPlanMeta, buildOrmQueryPlan, resolveTableColumns } from '../src/query-plan-meta';
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

  it('omits profileHash when the contract does not declare one', () => {
    const { profileHash: _, ...contractWithoutProfile } = baseContract;

    expect(buildOrmPlanMeta(contractWithoutProfile)).toEqual({
      target: contractWithoutProfile.target,
      targetFamily: contractWithoutProfile.targetFamily,
      storageHash: contractWithoutProfile.storageHash,
      lane: 'orm-client',
      paramDescriptors: [],
    });
  });

  it('adds limit annotations for select plans', () => {
    const ast = SelectAst.from(TableSource.named('users'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('users', 'id'))])
      .withLimit(5);

    const plan = buildOrmQueryPlan(baseContract, ast, ['Alice'], [{ index: 1, source: 'dsl' }]);
    expect(plan.meta.annotations).toMatchObject({ limit: 5 });
  });

  it('includes projectionTypes and codec annotations for select plans', () => {
    const ast = SelectAst.from(TableSource.named('users')).withProjection([
      ProjectionItem.of('id', ColumnRef.of('users', 'id')),
      ProjectionItem.of('email', ColumnRef.of('users', 'email')),
    ]);

    const plan = buildOrmQueryPlan(baseContract, ast, [], []);

    const expectedCodecs: Record<string, string> = {
      id: 'pg/int4@1',
      email: 'pg/text@1',
    };
    expect(plan.meta.projectionTypes).toEqual(expectedCodecs);
    expect(plan.meta.annotations).toEqual({ codecs: expectedCodecs });
  });

  it('includes projectionTypes for select plans with limit', () => {
    const ast = SelectAst.from(TableSource.named('users'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('users', 'id'))])
      .withLimit(10);

    const plan = buildOrmQueryPlan(baseContract, ast, [], []);

    expect(plan.meta.projectionTypes).toEqual({ id: 'pg/int4@1' });
    expect(plan.meta.annotations).toEqual({
      codecs: { id: 'pg/int4@1' },
      limit: 10,
    });
  });
});
