import type { ParamDescriptor } from '@prisma-next/contract/types';
import type { SqlContract, SqlStorage, StorageColumn } from '@prisma-next/sql-contract/types';
import type {
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  IncludeAst,
  OperationExpr,
  ParamRef,
  TableRef,
} from '@prisma-next/sql-relational-core/ast';
import { compact } from '@prisma-next/sql-relational-core/ast';
import type { QueryLaneContext } from '@prisma-next/sql-relational-core/query-lane-context';
import { schema } from '@prisma-next/sql-relational-core/schema';
import type {
  AnyBinaryBuilder,
  AnyColumnBuilder,
  AnyExpressionBuilder,
  AnyOrderBuilder,
  BuildOptions,
  NestedProjection,
} from '@prisma-next/sql-relational-core/types';
import { checkIncludeCapabilities } from '../orm/capabilities';
import type { OrmIncludeState, RelationFilter } from '../orm/state';
import { buildJoinOnExpr } from '../selection/join';
import { buildChildOrderByClause } from '../selection/ordering';
import { buildWhereExpr } from '../selection/predicates';
import {
  buildProjectionState,
  type ProjectionInput,
  type ProjectionState,
} from '../selection/projection';
import { createColumnRef, createSelectAst } from '../utils/ast';
import {
  errorChildProjectionEmpty,
  errorChildProjectionMustBeSpecified,
  errorColumnNotFound,
  errorJoinColumnsMustBeDefined,
  errorMissingAlias,
  errorMissingColumn,
  errorModelNotFound,
  errorMultiColumnJoinsNotSupported,
  errorTableNotFound,
} from '../utils/errors';
import { extractExpression } from '../utils/guards';

export interface IncludeState {
  readonly alias: string;
  readonly table: TableRef;
  readonly on: {
    kind: 'join-on';
    left: StorageColumn;
    right: StorageColumn;
  };
  readonly childProjection: ProjectionState;
  readonly childWhere?: AnyBinaryBuilder;
  readonly childOrderBy?: AnyOrderBuilder;
  readonly childLimit?: number;
}

export function buildIncludeAsts(
  includes: OrmIncludeState[],
  contract: SqlContract<SqlStorage>,
  context: QueryLaneContext<SqlContract<SqlStorage>>,
  modelName: string,
  paramsMap: Record<string, unknown>,
  paramDescriptors: ParamDescriptor[],
  paramValues: unknown[],
  paramCodecs: Record<string, string>,
): {
  includesAst: IncludeAst[];
  includesForMeta: IncludeState[];
} {
  const includesAst: IncludeAst[] = [];
  const includesForMeta: IncludeState[] = [];

  for (const includeState of includes) {
    checkIncludeCapabilities(contract);

    const parentTableName = contract.mappings.modelToTable?.[modelName];
    if (!parentTableName) {
      errorModelNotFound(modelName);
    }

    const parentSchemaHandle = schema(context);
    const parentSchemaTable = parentSchemaHandle.tables[parentTableName];
    if (!parentSchemaTable) {
      errorTableNotFound(parentTableName);
    }
    const childSchemaHandle = schema(context);
    const childSchemaTable = childSchemaHandle.tables[includeState.childTable.name];
    if (!childSchemaTable) {
      errorTableNotFound(includeState.childTable.name);
    }

    if (
      includeState.relation.on.parentCols.length !== 1 ||
      includeState.relation.on.childCols.length !== 1
    ) {
      errorMultiColumnJoinsNotSupported();
    }
    const parentColName = includeState.relation.on.parentCols[0];
    const childColName = includeState.relation.on.childCols[0];
    if (!parentColName || !childColName) {
      errorJoinColumnsMustBeDefined();
    }
    const parentCol = parentSchemaTable.columns[parentColName];
    const childCol = childSchemaTable.columns[childColName];
    if (!parentCol) {
      errorColumnNotFound(parentColName, parentTableName);
    }
    if (!childCol) {
      errorColumnNotFound(childColName, includeState.childTable.name);
    }

    const onExpr = buildJoinOnExpr(
      parentTableName,
      parentColName,
      includeState.childTable.name,
      childColName,
    );

    if (!includeState.childProjection) {
      errorChildProjectionMustBeSpecified();
    }
    const filteredProjection: Record<string, AnyColumnBuilder | NestedProjection> = {};
    for (const [key, value] of Object.entries(includeState.childProjection)) {
      if (value !== true && value !== false) {
        filteredProjection[key] = value as AnyColumnBuilder | NestedProjection;
      }
    }
    if (Object.keys(filteredProjection).length === 0) {
      errorChildProjectionEmpty();
    }
    const childProjectionState = buildProjectionState(
      includeState.childTable,
      filteredProjection as ProjectionInput,
    );

    let childWhere: BinaryExpr | undefined;
    if (includeState.childWhere) {
      const whereResult = buildWhereExpr(
        includeState.childWhere,
        contract,
        paramsMap,
        paramDescriptors,
        paramValues,
      );
      childWhere = whereResult.expr;
      if (whereResult.codecId && whereResult.paramName) {
        paramCodecs[whereResult.paramName] = whereResult.codecId;
      }
    }

    const childOrderBy = buildChildOrderByClause(includeState.childOrderBy);

    const childProjectionItems: Array<{ alias: string; expr: ColumnRef | OperationExpr }> = [];
    for (let i = 0; i < childProjectionState.aliases.length; i++) {
      const alias = childProjectionState.aliases[i];
      if (!alias) {
        errorMissingAlias(i);
      }
      const column = childProjectionState.columns[i];
      if (!column) {
        errorMissingColumn(alias, i);
      }
      const expr = extractExpression(column as AnyColumnBuilder | AnyExpressionBuilder);
      childProjectionItems.push({ alias, expr });
    }

    const includeAst: IncludeAst = compact({
      kind: 'includeMany',
      alias: includeState.alias,
      child: compact({
        table: includeState.childTable,
        on: onExpr,
        project: childProjectionItems,
        where: childWhere,
        orderBy: childOrderBy,
        limit: includeState.childLimit,
      }),
    }) as IncludeAst;
    includesAst.push(includeAst);

    const includeForMeta: IncludeState = compact({
      alias: includeState.alias,
      table: includeState.childTable,
      on: {
        kind: 'join-on',
        left: parentCol as unknown as StorageColumn,
        right: childCol as unknown as StorageColumn,
      },
      childProjection: childProjectionState,
      childWhere: includeState.childWhere,
      childOrderBy: includeState.childOrderBy,
      childLimit: includeState.childLimit,
    }) as IncludeState;
    includesForMeta.push(includeForMeta);
  }

  return { includesAst, includesForMeta };
}

export function buildExistsSubqueries(
  relationFilters: RelationFilter[],
  contract: SqlContract<SqlStorage>,
  modelName: string,
  options?: BuildOptions,
): ExistsExpr[] {
  const existsExprs: ExistsExpr[] = [];

  for (const filter of relationFilters) {
    const childTableName = contract.mappings.modelToTable?.[filter.childModelName];
    if (!childTableName) {
      errorModelNotFound(filter.childModelName);
    }

    const childTable: TableRef = { kind: 'table', name: childTableName };
    const parentTableName = contract.mappings.modelToTable?.[modelName];
    if (!parentTableName) {
      errorModelNotFound(modelName);
    }

    const joinConditions: Array<{ left: ColumnRef; right: ColumnRef }> = [];
    for (let i = 0; i < filter.relation.on.parentCols.length; i++) {
      const parentCol = filter.relation.on.parentCols[i];
      const childCol = filter.relation.on.childCols[i];
      if (!parentCol || !childCol) {
        continue;
      }
      joinConditions.push({
        left: { kind: 'col', table: parentTableName, column: parentCol },
        right: { kind: 'col', table: childTableName, column: childCol },
      });
    }

    let childWhere: BinaryExpr | undefined;
    if (filter.childWhere) {
      const paramsMap = (options?.params ?? {}) as Record<string, unknown>;
      const paramDescriptors: ParamDescriptor[] = [];
      const paramValues: unknown[] = [];
      const whereResult = buildWhereExpr(
        filter.childWhere,
        contract,
        paramsMap,
        paramDescriptors,
        paramValues,
      );
      childWhere = whereResult.expr;
    }

    let subqueryWhere: BinaryExpr | undefined = childWhere;
    if (joinConditions.length > 0) {
      const firstJoinCondition = joinConditions[0];
      if (firstJoinCondition) {
        const joinWhere: BinaryExpr = {
          kind: 'bin',
          op: 'eq',
          left: firstJoinCondition.left,
          right: firstJoinCondition.right as unknown as ParamRef,
        };
        if (childWhere) {
          subqueryWhere = joinWhere;
        } else {
          subqueryWhere = joinWhere;
        }
      }
    }
    const projectionColumn = joinConditions[0]?.right ?? createColumnRef(childTableName, 'id');
    const subquery = createSelectAst({
      from: childTable,
      project: [{ alias: '_exists', expr: projectionColumn }],
      where: subqueryWhere,
    } as {
      from: TableRef;
      project: ReadonlyArray<{ alias: string; expr: ColumnRef }>;
      where?: BinaryExpr | ExistsExpr;
    });

    const notExists = filter.filterType === 'none' || filter.filterType === 'every';

    const existsExpr: ExistsExpr = {
      kind: 'exists',
      subquery,
      not: notExists,
    };

    existsExprs.push(existsExpr);
  }

  return existsExprs;
}

export function combineWhereClauses(
  mainWhere: BinaryExpr | ExistsExpr | undefined,
  existsExprs: ExistsExpr[],
): BinaryExpr | ExistsExpr | undefined {
  if (existsExprs.length === 1) {
    return existsExprs[0];
  }
  if (mainWhere) {
    return mainWhere;
  }
  if (existsExprs.length > 0) {
    return existsExprs[0];
  }
  return undefined;
}
