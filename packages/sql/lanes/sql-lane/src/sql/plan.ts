import type { PlanMeta } from '@prisma-next/contract/types';
import { compact } from '@prisma-next/sql-relational-core/ast';
import type {
  AnyColumnBuilder,
  AnyExpressionBuilder,
} from '@prisma-next/sql-relational-core/types';
import type { MetaBuildArgs } from '../types/internal';
import { errorMissingColumnForAlias } from '../utils/errors';
import {
  collectColumnRefs,
  extractExpression,
  getColumnInfo,
  isColumnBuilder,
  isExpressionBuilder,
  isOperationExpr,
} from '../utils/guards';

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

  if (args.joins) {
    for (const join of args.joins) {
      refsTables.add(join.table.name);
      // TypeScript can't narrow ColumnBuilder properly
      const onLeft = join.on.left as unknown as { table: string; column: string };
      const onRight = join.on.right as unknown as { table: string; column: string };
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
      // Add child projection columns
      for (const column of include.childProjection.columns) {
        const col = column as unknown as { table?: string; column?: string };
        if (col.table && col.column) {
          refsColumns.set(`${col.table}.${col.column}`, {
            table: col.table,
            column: col.column,
          });
        }
      }
      // Add child WHERE columns if present
      if (include.childWhere) {
        const colInfo = getColumnInfo(include.childWhere.left);
        refsColumns.set(`${colInfo.table}.${colInfo.column}`, {
          table: colInfo.table,
          column: colInfo.column,
        });
        // Handle right side of child WHERE clause
        const childWhereRight = include.childWhere.right;
        if (isColumnBuilder(childWhereRight)) {
          const rightColInfo = getColumnInfo(childWhereRight);
          refsColumns.set(`${rightColInfo.table}.${rightColInfo.column}`, {
            table: rightColInfo.table,
            column: rightColInfo.column,
          });
        }
      }
      // Add child ORDER BY columns if present
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

    // Handle right side of WHERE clause - can be ParamPlaceholder or AnyColumnBuilder
    const whereRight = args.where.right;
    if (isColumnBuilder(whereRight)) {
      const colInfo = getColumnInfo(whereRight);
      refsColumns.set(`${colInfo.table}.${colInfo.column}`, {
        table: colInfo.table,
        column: colInfo.column,
      });
    }
  }

  if (args.orderBy) {
    const orderBy = args.orderBy as unknown as {
      expr?: AnyColumnBuilder | AnyExpressionBuilder;
    };
    const orderByExpr = orderBy.expr;
    if (orderByExpr) {
      const extractedExpr = extractExpression(orderByExpr);
      if (isOperationExpr(extractedExpr)) {
        const allRefs = collectColumnRefs(extractedExpr);
        for (const ref of allRefs) {
          refsColumns.set(`${ref.table}.${ref.column}`, {
            table: ref.table,
            column: ref.column,
          });
        }
      } else {
        // extractedExpr is ColumnRef
        refsColumns.set(`${extractedExpr.table}.${extractedExpr.column}`, {
          table: extractedExpr.table,
          column: extractedExpr.column,
        });
      }
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
        errorMissingColumnForAlias(alias, index);
      }
      const expr = extractExpression(column as AnyColumnBuilder | AnyExpressionBuilder);
      if (isOperationExpr(expr)) {
        return [alias, `operation:${expr.method}`];
      }
      // expr is ColumnRef
      return [alias, `${expr.table}.${expr.column}`];
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
    const expr = extractExpression(column as AnyColumnBuilder | AnyExpressionBuilder);
    if (isOperationExpr(expr)) {
      if (expr.returns.kind === 'typeId') {
        projectionTypes[alias] = expr.returns.type;
      } else if (expr.returns.kind === 'builtin') {
        projectionTypes[alias] = expr.returns.type;
      }
    } else {
      // expr is ColumnRef - get codecId from columnMeta
      if (isExpressionBuilder(column)) {
        const codecId = column.columnMeta.codecId;
        if (codecId) {
          projectionTypes[alias] = codecId;
        }
      } else {
        // column is ColumnBuilder
        const col = column as { columnMeta?: { codecId: string } };
        const columnMeta = col.columnMeta;
        const codecId = columnMeta?.codecId;
        if (codecId) {
          projectionTypes[alias] = codecId;
        }
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
        const col = column as { columnMeta?: { codecId: string } };
        const columnMeta = col.columnMeta;
        const codecId = columnMeta?.codecId;
        if (codecId) {
          projectionCodecs[alias] = codecId;
        }
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
