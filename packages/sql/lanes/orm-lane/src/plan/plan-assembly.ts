import type { ExecutionPlan, ParamDescriptor, PlanMeta } from '@prisma-next/contract/types';
import { planInvalid } from '@prisma-next/plan';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  BinaryExpr,
  ExistsExpr,
  LoweredStatement,
  SelectAst,
  TableRef,
} from '@prisma-next/sql-relational-core/ast';
import { compact } from '@prisma-next/sql-relational-core/ast';
import type {
  AnyColumnBuilder,
  AnyExpressionBuilder,
  AnyOrderBuilder,
  BinaryBuilder,
} from '@prisma-next/sql-relational-core/types';
import type { IncludeState } from '../relations/include-plan';
import type { ProjectionState } from '../selection/projection';
import {
  collectColumnRefs,
  extractExpression,
  getColumnInfo,
  getColumnMeta,
  isExpressionBuilder,
  isOperationExpr,
} from '../utils/guards';

export interface MetaBuildArgs {
  readonly contract: SqlContract<SqlStorage>;
  readonly table: TableRef;
  readonly projection: ProjectionState;
  readonly includes?: ReadonlyArray<IncludeState>;
  readonly where?: BinaryBuilder;
  readonly orderBy?: AnyOrderBuilder;
  readonly paramDescriptors: ParamDescriptor[];
  readonly paramCodecs?: Record<string, string>;
}

export function buildMeta(args: MetaBuildArgs): PlanMeta {
  const refsColumns = new Map<string, { table: string; column: string }>();
  const refsTables = new Set<string>([args.table.name]);

  for (const column of args.projection.columns) {
    const expr = extractExpression(column as AnyColumnBuilder | AnyExpressionBuilder);
    if (isOperationExpr(expr)) {
      const allRefs = collectColumnRefs(expr);
      for (const ref of allRefs) {
        refsColumns.set(`${ref.table}.${ref.column}`, {
          table: ref.table,
          column: ref.column,
        });
      }
    } else {
      // expr is ColumnRef
      refsColumns.set(`${expr.table}.${expr.column}`, {
        table: expr.table,
        column: expr.column,
      });
    }
  }

  if (args.includes) {
    for (const include of args.includes) {
      refsTables.add(include.table.name);
      const onLeft = include.on.left as unknown as { table: string; column: string };
      const onRight = include.on.right as unknown as { table: string; column: string };
      if (onLeft.table && onLeft.column && onRight.table && onRight.column) {
        refsColumns.set(`${onLeft.table}.${onLeft.column}`, {
          table: onLeft.table,
          column: onLeft.column,
        });
        refsColumns.set(`${onRight.table}.${onRight.column}`, {
          table: onRight.table,
          column: onRight.column,
        });
      }
      for (const column of include.childProjection.columns) {
        const col = column as unknown as { table?: string; column?: string };
        if (col.table && col.column) {
          refsColumns.set(`${col.table}.${col.column}`, {
            table: col.table,
            column: col.column,
          });
        }
      }
      if (include.childWhere) {
        const colInfo = getColumnInfo(include.childWhere.left);
        refsColumns.set(`${colInfo.table}.${colInfo.column}`, {
          table: colInfo.table,
          column: colInfo.column,
        });
      }
      if (include.childOrderBy) {
        const orderBy = include.childOrderBy as unknown as {
          expr?: AnyColumnBuilder | AnyExpressionBuilder;
        };
        if (orderBy.expr) {
          const colInfo = getColumnInfo(orderBy.expr);
          refsColumns.set(`${colInfo.table}.${colInfo.column}`, {
            table: colInfo.table,
            column: colInfo.column,
          });
        }
      }
    }
  }

  if (args.where) {
    const whereLeft = args.where.left;
    const expr = extractExpression(whereLeft as AnyColumnBuilder | AnyExpressionBuilder);
    if (isOperationExpr(expr)) {
      const allRefs = collectColumnRefs(expr);
      for (const ref of allRefs) {
        refsColumns.set(`${ref.table}.${ref.column}`, {
          table: ref.table,
          column: ref.column,
        });
      }
    } else {
      // expr is ColumnRef
      refsColumns.set(`${expr.table}.${expr.column}`, {
        table: expr.table,
        column: expr.column,
      });
    }
  }

  if (args.orderBy) {
    const orderBy = args.orderBy as unknown as {
      expr?: AnyColumnBuilder | AnyExpressionBuilder;
    };
    const orderByExpr = orderBy.expr;
    if (orderByExpr) {
      const expr = extractExpression(orderByExpr);
      if (isOperationExpr(expr)) {
        const allRefs = collectColumnRefs(expr);
        for (const ref of allRefs) {
          refsColumns.set(`${ref.table}.${ref.column}`, {
            table: ref.table,
            column: ref.column,
          });
        }
      } else {
        // expr is ColumnRef
        refsColumns.set(`${expr.table}.${expr.column}`, {
          table: expr.table,
          column: expr.column,
        });
      }
    }
  }

  const includeAliases = new Set(args.includes?.map((inc) => inc.alias) ?? []);
  const projectionMap = Object.fromEntries(
    args.projection.aliases.map((alias, index) => {
      if (includeAliases.has(alias)) {
        return [alias, `include:${alias}`];
      }
      const column = args.projection.columns[index];
      if (!column) {
        throw planInvalid(`Missing column for alias ${alias} at index ${index}`);
      }
      const expr = extractExpression(column as AnyColumnBuilder | AnyExpressionBuilder);
      if (isOperationExpr(expr)) {
        return [alias, `operation:${expr.method}`];
      }
      // expr is ColumnRef
      return [alias, `${expr.table}.${expr.column}`];
    }),
  );

  const projectionTypes: Record<string, string> = {};
  for (let i = 0; i < args.projection.aliases.length; i++) {
    const alias = args.projection.aliases[i];
    if (!alias || includeAliases.has(alias)) {
      continue;
    }
    const col = args.projection.columns[i];
    if (!col) {
      continue;
    }
    const expr = extractExpression(col as AnyColumnBuilder | AnyExpressionBuilder);
    if (isOperationExpr(expr)) {
      if (expr.returns.kind === 'typeId') {
        projectionTypes[alias] = expr.returns.type;
      } else if (expr.returns.kind === 'builtin') {
        projectionTypes[alias] = expr.returns.type;
      }
    } else {
      // expr is ColumnRef - get codecId from columnMeta
      if (isExpressionBuilder(col)) {
        const codecId = col.columnMeta.codecId;
        if (codecId) {
          projectionTypes[alias] = codecId;
        }
      } else {
        // col is ColumnBuilder
        const columnMeta = getColumnMeta(col);
        const codecId = columnMeta?.codecId;
        if (codecId) {
          projectionTypes[alias] = codecId;
        }
      }
    }
  }

  const projectionCodecs: Record<string, string> = {};
  for (let i = 0; i < args.projection.aliases.length; i++) {
    const alias = args.projection.aliases[i];
    if (!alias || includeAliases.has(alias)) {
      continue;
    }
    const column = args.projection.columns[i];
    if (!column) {
      continue;
    }
    const expr = extractExpression(column as AnyColumnBuilder | AnyExpressionBuilder);
    if (isOperationExpr(expr)) {
      if (expr.returns.kind === 'typeId') {
        projectionCodecs[alias] = expr.returns.type;
      }
    } else {
      // expr is ColumnRef - get codecId from columnMeta
      if (isExpressionBuilder(column)) {
        const codecId = column.columnMeta.codecId;
        if (codecId) {
          projectionCodecs[alias] = codecId;
        }
      } else {
        // column is ColumnBuilder
        const columnMeta = getColumnMeta(column);
        const codecId = columnMeta?.codecId;
        if (codecId) {
          projectionCodecs[alias] = codecId;
        }
      }
    }
  }

  const allCodecs: Record<string, string> = {
    ...projectionCodecs,
    ...(args.paramCodecs ? args.paramCodecs : {}),
  };

  return Object.freeze(
    compact({
      target: args.contract.target,
      targetFamily: args.contract.targetFamily,
      coreHash: args.contract.coreHash,
      lane: 'dsl',
      refs: {
        tables: Array.from(refsTables),
        columns: Array.from(refsColumns.values()),
      },
      projection: projectionMap,
      projectionTypes: Object.keys(projectionTypes).length > 0 ? projectionTypes : undefined,
      annotations:
        Object.keys(allCodecs).length > 0
          ? Object.freeze({ codecs: Object.freeze(allCodecs) })
          : undefined,
      paramDescriptors: args.paramDescriptors,
      profileHash: args.contract.profileHash,
    }) as PlanMeta,
  );
}

export function createPlan<Row>(
  ast: SelectAst,
  lowered: { body: LoweredStatement },
  paramValues: unknown[],
  planMeta: PlanMeta,
): ExecutionPlan<Row> {
  return Object.freeze({
    ast,
    sql: lowered.body.sql,
    params: lowered.body.params ?? paramValues,
    meta: {
      ...planMeta,
      lane: 'orm',
    },
  });
}

export function createPlanWithExists<Row>(
  ast: SelectAst,
  combinedWhere: BinaryExpr | ExistsExpr | undefined,
  lowered: { body: LoweredStatement },
  paramValues: unknown[],
  planMeta: PlanMeta,
): ExecutionPlan<Row> {
  const modifiedAst: SelectAst = {
    ...ast,
    ...(combinedWhere !== undefined ? { where: combinedWhere } : {}),
  };
  return Object.freeze({
    ast: modifiedAst,
    sql: lowered.body.sql,
    params: lowered.body.params ?? paramValues,
    meta: {
      ...planMeta,
      lane: 'orm',
    },
  });
}
