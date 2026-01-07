import type { ExecutionPlan, ParamDescriptor, PlanMeta } from '@prisma-next/contract/types';
import { planInvalid } from '@prisma-next/plan';
import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  BinaryExpr,
  ExistsExpr,
  Expression,
  LoweredStatement,
  SelectAst,
  TableRef,
} from '@prisma-next/sql-relational-core/ast';
import { compact } from '@prisma-next/sql-relational-core/ast';
import {
  collectColumnRefs,
  getColumnMeta,
  isColumnBuilder,
  isExpressionBuilder,
  isOperationExpr,
} from '@prisma-next/sql-relational-core/guards';
import type {
  AnyExpressionSource,
  AnyOrderBuilder,
  BinaryBuilder,
} from '@prisma-next/sql-relational-core/types';
import type { IncludeState } from '../relations/include-plan';
import type { ProjectionState } from '../selection/projection';

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

/**
 * Extracts column references from an ExpressionSource (ColumnBuilder or ExpressionBuilder).
 * Skips entries with empty table or column names (e.g., placeholder columns for includes).
 */
function collectRefsFromExpressionSource(
  source: AnyExpressionSource,
  refsColumns: Map<string, { table: string; column: string }>,
): void {
  if (isExpressionBuilder(source)) {
    const allRefs = collectColumnRefs(source.expr);
    for (const ref of allRefs) {
      // Skip empty table/column (placeholders for includes)
      if (ref.table && ref.column) {
        refsColumns.set(`${ref.table}.${ref.column}`, {
          table: ref.table,
          column: ref.column,
        });
      }
    }
  } else if (isColumnBuilder(source)) {
    const col = source as unknown as { table: string; column: string };
    // Skip empty table/column (placeholders for includes)
    if (col.table && col.column) {
      refsColumns.set(`${col.table}.${col.column}`, {
        table: col.table,
        column: col.column,
      });
    }
  }
}

/**
 * Extracts column references from an Expression (AST node).
 */
function collectRefsFromExpression(
  expr: Expression,
  refsColumns: Map<string, { table: string; column: string }>,
): void {
  if (isOperationExpr(expr)) {
    const allRefs = collectColumnRefs(expr);
    for (const ref of allRefs) {
      refsColumns.set(`${ref.table}.${ref.column}`, {
        table: ref.table,
        column: ref.column,
      });
    }
  } else if (expr.kind === 'col') {
    refsColumns.set(`${expr.table}.${expr.column}`, {
      table: expr.table,
      column: expr.column,
    });
  }
}

export function buildMeta(args: MetaBuildArgs): PlanMeta {
  const refsColumns = new Map<string, { table: string; column: string }>();
  const refsTables = new Set<string>([args.table.name]);

  for (const column of args.projection.columns) {
    collectRefsFromExpressionSource(column, refsColumns);
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
        // childWhere.left is Expression (already converted at builder creation time)
        collectRefsFromExpression(include.childWhere.left, refsColumns);
      }
      if (include.childOrderBy) {
        // childOrderBy.expr is Expression (already converted at builder creation time)
        collectRefsFromExpression(include.childOrderBy.expr, refsColumns);
      }
    }
  }

  if (args.where) {
    // args.where.left is Expression (already converted at builder creation time)
    const leftExpr: Expression = args.where.left;
    if (isOperationExpr(leftExpr)) {
      const allRefs = collectColumnRefs(leftExpr);
      for (const ref of allRefs) {
        refsColumns.set(`${ref.table}.${ref.column}`, {
          table: ref.table,
          column: ref.column,
        });
      }
    } else {
      // leftExpr is ColumnRef
      refsColumns.set(`${leftExpr.table}.${leftExpr.column}`, {
        table: leftExpr.table,
        column: leftExpr.column,
      });
    }
  }

  if (args.orderBy) {
    // args.orderBy.expr is Expression (already converted at builder creation time)
    const orderByExpr: Expression = args.orderBy.expr;
    if (isOperationExpr(orderByExpr)) {
      const allRefs = collectColumnRefs(orderByExpr);
      for (const ref of allRefs) {
        refsColumns.set(`${ref.table}.${ref.column}`, {
          table: ref.table,
          column: ref.column,
        });
      }
    } else {
      // orderByExpr is ColumnRef
      refsColumns.set(`${orderByExpr.table}.${orderByExpr.column}`, {
        table: orderByExpr.table,
        column: orderByExpr.column,
      });
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
      if (isExpressionBuilder(column)) {
        return [alias, `operation:${column.expr.method}`];
      }
      // column is ColumnBuilder
      const col = column as unknown as { table?: string; column?: string };
      if (!col.table || !col.column) {
        return [alias, `include:${alias}`];
      }
      return [alias, `${col.table}.${col.column}`];
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
    if (isExpressionBuilder(col)) {
      const operationExpr = col.expr;
      if (operationExpr.returns.kind === 'typeId') {
        projectionTypes[alias] = operationExpr.returns.type;
      } else if (operationExpr.returns.kind === 'builtin') {
        projectionTypes[alias] = operationExpr.returns.type;
      }
    } else {
      const columnMeta = getColumnMeta(col);
      const codecId = columnMeta?.codecId;
      if (codecId) {
        projectionTypes[alias] = codecId;
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
    if (isExpressionBuilder(column)) {
      const operationExpr = column.expr;
      if (operationExpr.returns.kind === 'typeId') {
        projectionCodecs[alias] = operationExpr.returns.type;
      }
    } else {
      const columnMeta = getColumnMeta(column);
      const codecId = columnMeta?.codecId;
      if (codecId) {
        projectionCodecs[alias] = codecId;
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
