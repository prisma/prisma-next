import type { PlanMeta } from '@prisma-next/contract/types';
import type { OperationExpr } from '@prisma-next/sql-relational-core/ast';
import { compact } from '@prisma-next/sql-relational-core/ast';
import type { AnyColumnBuilder } from '@prisma-next/sql-relational-core/types';
import type { MetaBuildArgs } from '../types/internal';
import { assertColumnBuilder } from '../utils/assertions';
import { errorMissingColumnForAlias } from '../utils/errors';
import {
  collectColumnRefs,
  getColumnInfo,
  getOperationExpr,
  isColumnBuilder,
  isOperationExpr,
} from '../utils/guards';

export function buildMeta(args: MetaBuildArgs): PlanMeta {
  const refsColumns = new Map<string, { table: string; column: string }>();
  const refsTables = new Set<string>([args.table.name]);

  for (const column of args.projection.columns) {
    // Skip null columns (include placeholders)
    if (!column) {
      continue;
    }
    const operationExpr = getOperationExpr(column);
    if (operationExpr) {
      const allRefs = collectColumnRefs(operationExpr);
      for (const ref of allRefs) {
        refsColumns.set(`${ref.table}.${ref.column}`, {
          table: ref.table,
          column: ref.column,
        });
      }
    } else {
      refsColumns.set(`${column.table}.${column.column}`, {
        table: column.table,
        column: column.column,
      });
    }
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
          expr?: AnyColumnBuilder | OperationExpr;
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
    // Check if whereLeft is an OperationExpr directly (not wrapped in ColumnBuilder)
    if (isOperationExpr(whereLeft)) {
      const allRefs = collectColumnRefs(whereLeft);
      for (const ref of allRefs) {
        refsColumns.set(`${ref.table}.${ref.column}`, {
          table: ref.table,
          column: ref.column,
        });
      }
    } else {
      // Check if whereLeft is a ColumnBuilder with an _operationExpr property
      const operationExpr = (whereLeft as { _operationExpr?: OperationExpr })._operationExpr;
      if (operationExpr) {
        const allRefs = collectColumnRefs(operationExpr);
        for (const ref of allRefs) {
          refsColumns.set(`${ref.table}.${ref.column}`, {
            table: ref.table,
            column: ref.column,
          });
        }
      } else {
        const colBuilder = assertColumnBuilder(whereLeft, 'where clause must be a ColumnBuilder');
        refsColumns.set(`${colBuilder.table}.${colBuilder.column}`, {
          table: colBuilder.table,
          column: colBuilder.column,
        });
      }
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
      expr?: AnyColumnBuilder | OperationExpr;
    };
    const orderByExpr = orderBy.expr;
    if (orderByExpr) {
      if (isOperationExpr(orderByExpr)) {
        const allRefs = collectColumnRefs(orderByExpr);
        for (const ref of allRefs) {
          refsColumns.set(`${ref.table}.${ref.column}`, {
            table: ref.table,
            column: ref.column,
          });
        }
      } else {
        refsColumns.set(`${orderByExpr.table}.${orderByExpr.column}`, {
          table: orderByExpr.table,
          column: orderByExpr.column,
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
        // Null column means this is an include placeholder, but alias doesn't match includes
        // This shouldn't happen if projection building is correct, but handle gracefully
        errorMissingColumnForAlias(alias, index);
      }

      // Check for operation expression before asserting column builder
      const operationExpr = getOperationExpr(column);
      if (operationExpr) {
        return [alias, `operation:${operationExpr.method}`];
      }

      return [alias, `${column.table}.${column.column}`];
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
    const operationExpr = (column as { _operationExpr?: OperationExpr })._operationExpr;
    if (operationExpr) {
      if (operationExpr.returns.kind === 'typeId') {
        projectionTypes[alias] = operationExpr.returns.type;
      } else if (operationExpr.returns.kind === 'builtin') {
        projectionTypes[alias] = operationExpr.returns.type;
      }
    } else {
      // TypeScript can't narrow ColumnBuilder properly
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
    const operationExpr = (column as { _operationExpr?: OperationExpr })._operationExpr;
    if (operationExpr) {
      if (operationExpr.returns.kind === 'typeId') {
        projectionCodecs[alias] = operationExpr.returns.type;
      }
    } else {
      // Use columnMeta.codecId directly as typeId (already canonicalized)
      // TypeScript can't narrow ColumnBuilder properly
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
