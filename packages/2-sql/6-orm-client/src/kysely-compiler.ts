import type { ContractBase, ExecutionPlan } from '@prisma-next/contract/types';
import {
  type CompiledQuery,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import type { CollectionState, ComparisonOp } from './types';

type AnyDB = Record<string, Record<string, unknown>>;

const queryCompiler = new Kysely<AnyDB>({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

type SqlComparisonOp = '=' | '!=' | '>' | '<' | '>=' | '<=';

const comparisonOpToSql: Record<ComparisonOp, SqlComparisonOp> = {
  eq: '=',
  neq: '!=',
  gt: '>',
  lt: '<',
  gte: '>=',
  lte: '<=',
};

export function compileSelect(tableName: string, state: CollectionState): CompiledQuery {
  let qb = queryCompiler.selectFrom(tableName).selectAll();

  for (const f of state.filters) {
    qb = qb.where(f.column, comparisonOpToSql[f.op], f.value);
  }

  if (state.orderBy) {
    for (const o of state.orderBy) {
      qb = qb.orderBy(o.column, o.direction);
    }
  }

  if (state.limit !== undefined) {
    qb = qb.limit(state.limit);
  }

  if (state.offset !== undefined) {
    qb = qb.offset(state.offset);
  }

  return qb.compile();
}

export function compileRelationSelect(
  relatedTableName: string,
  fkColumn: string,
  parentPks: readonly unknown[],
  nestedState: CollectionState,
): CompiledQuery {
  let qb = queryCompiler
    .selectFrom(relatedTableName)
    .selectAll()
    .where(fkColumn, 'in', [...parentPks]);

  for (const f of nestedState.filters) {
    qb = qb.where(f.column, comparisonOpToSql[f.op], f.value);
  }

  if (nestedState.orderBy) {
    for (const o of nestedState.orderBy) {
      qb = qb.orderBy(o.column, o.direction);
    }
  }

  return qb.compile();
}

export function createExecutionPlan<Row>(
  compiled: CompiledQuery,
  contract: ContractBase,
): ExecutionPlan<Row> {
  return {
    sql: compiled.sql,
    params: [...compiled.parameters],
    meta: {
      target: contract.target,
      targetFamily: contract.targetFamily,
      storageHash: contract.storageHash,
      lane: 'orm-client',
      paramDescriptors: [],
    },
  };
}
