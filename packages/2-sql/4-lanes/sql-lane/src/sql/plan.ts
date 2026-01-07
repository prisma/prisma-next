import type { PlanMeta } from '@prisma-next/contract/types';
import type { Expression } from '@prisma-next/sql-relational-core/ast';
import { compact } from '@prisma-next/sql-relational-core/ast';
import {
  collectColumnRefs,
  isColumnBuilder,
  isExpressionBuilder,
  isOperationExpr,
} from '@prisma-next/sql-relational-core/guards';
import type { AnyExpressionSource } from '@prisma-next/sql-relational-core/types';
import type { MetaBuildArgs } from '../types/internal.ts';
import { assertColumnBuilder } from '../utils/assertions.ts';
import { errorMissingColumnForAlias } from '../utils/errors.ts';

/**
 * Extracts column references from an ExpressionSource (ColumnBuilder or ExpressionBuilder).
 */
function collectRefsFromExpressionSource(
  source: AnyExpressionSource,
  refsColumns: Map<string, { table: string; column: string }>,
): void {
  if (isExpressionBuilder(source)) {
    // ExpressionBuilder has an OperationExpr - collect all column refs
    const allRefs = collectColumnRefs(source.expr);
    for (const ref of allRefs) {
      refsColumns.set(`${ref.table}.${ref.column}`, {
        table: ref.table,
        column: ref.column,
      });
    }
  } else if (isColumnBuilder(source)) {
    // ColumnBuilder - use table and column directly
    const col = source as unknown as { table: string; column: string };
    refsColumns.set(`${col.table}.${col.column}`, {
      table: col.table,
      column: col.column,
    });
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

  if (args.joins) {
    for (const join of args.joins) {
      refsTables.add(join.table.name);
      const onLeft = assertColumnBuilder(join.on.left, 'join ON left');
      const onRight = assertColumnBuilder(join.on.right, 'join ON right');
      refsColumns.set(`${onLeft.table}.${onLeft.column}`, {
        table: onLeft.table,
        column: onLeft.column,
      });
      refsColumns.set(`${onRight.table}.${onRight.column}`, {
        table: onRight.table,
        column: onRight.column,
      });
    }
  }

  if (args.includes) {
    for (const include of args.includes) {
      refsTables.add(include.table.name);
      // Add ON condition columns
      // JoinOnPredicate.left and .right are always ColumnBuilder
      const leftCol = assertColumnBuilder(include.on.left, 'include ON left');
      const rightCol = assertColumnBuilder(include.on.right, 'include ON right');
      refsColumns.set(`${leftCol.table}.${leftCol.column}`, {
        table: leftCol.table,
        column: leftCol.column,
      });
      refsColumns.set(`${rightCol.table}.${rightCol.column}`, {
        table: rightCol.table,
        column: rightCol.column,
      });
      // Add child projection columns
      for (const column of include.childProjection.columns) {
        const col = assertColumnBuilder(column, 'include child projection column');

        refsColumns.set(`${col.table}.${col.column}`, {
          table: col.table,
          column: col.column,
        });
      }
      // Add child WHERE columns if present
      if (include.childWhere) {
        // childWhere.left is Expression (already converted at builder creation time)
        collectRefsFromExpression(include.childWhere.left, refsColumns);
        // Handle right side of child WHERE clause - can be ParamPlaceholder or ExpressionSource
        const childWhereRight = include.childWhere.right;
        if (isColumnBuilder(childWhereRight) || isExpressionBuilder(childWhereRight)) {
          collectRefsFromExpressionSource(childWhereRight, refsColumns);
        }
      }
      // Add child ORDER BY columns if present
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

    // Handle right side of WHERE clause - can be ParamPlaceholder or AnyExpressionSource
    const whereRight = args.where.right;
    if (isColumnBuilder(whereRight) || isExpressionBuilder(whereRight)) {
      collectRefsFromExpressionSource(whereRight, refsColumns);
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

  // Build projection map - mark include aliases with special marker
  const includeAliases = new Set(args.includes?.map((inc) => inc.alias) ?? []);
  const projectionMap = Object.fromEntries(
    args.projection.aliases.map((alias, index) => {
      if (includeAliases.has(alias)) {
        // Mark include alias with special marker
        return [alias, `include:${alias}`];
      }
      const column = args.projection.columns[index];
      if (!column) {
        // Null column means this is an include placeholder, but alias doesn't match includes
        // This shouldn't happen if projection building is correct, but handle gracefully
        errorMissingColumnForAlias(alias, index);
      }
      // Check if column is an ExpressionBuilder (operation result)
      if (isExpressionBuilder(column)) {
        return [alias, `operation:${column.expr.method}`];
      }
      // column is ColumnBuilder
      const col = column as unknown as { table?: string; column?: string };
      if (!col.table || !col.column) {
        // This is a placeholder column for an include - skip it
        return [alias, `include:${alias}`];
      }

      return [alias, `${col.table}.${col.column}`];
    }),
  );

  // Build projectionTypes mapping: alias → column type ID
  // Skip include aliases - they don't have column types
  const projectionTypes: Record<string, string> = {};
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
        projectionTypes[alias] = operationExpr.returns.type;
      } else if (operationExpr.returns.kind === 'builtin') {
        projectionTypes[alias] = operationExpr.returns.type;
      }
    } else {
      // column is ColumnBuilder
      const col = column as unknown as { columnMeta?: { codecId: string } };
      const columnMeta = col.columnMeta;
      const codecId = columnMeta?.codecId;
      if (codecId) {
        projectionTypes[alias] = codecId;
      }
    }
  }

  // Build codec assignments from column types
  // Skip include aliases - they don't need codec entries
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
      // Use columnMeta.codecId directly as typeId (already canonicalized)
      // column is ColumnBuilder
      const col = column as unknown as { columnMeta?: { codecId: string } };
      const columnMeta = col.columnMeta;
      const codecId = columnMeta?.codecId;
      if (codecId) {
        projectionCodecs[alias] = codecId;
      }
    }
  }

  // Merge projection and parameter codecs
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
