import type { PlanMeta } from '@prisma-next/contract/types';
import { compact } from '@prisma-next/sql-relational-core/ast';
import type { AnyColumnBuilder } from '@prisma-next/sql-relational-core/types';
import type { OperationExpr } from '@prisma-next/sql-target';
import type { MetaBuildArgs } from '../types/internal';
import { errorMissingColumnForAlias } from '../utils/errors';
import { collectColumnRefs, getColumnInfo, isOperationExpr } from '../utils/guards';

export function buildMeta(args: MetaBuildArgs): PlanMeta {
  const refsColumns = new Map<string, { table: string; column: string }>();
  const refsTables = new Set<string>([args.table.name]);

  for (const column of args.projection.columns) {
    const operationExpr = (column as { _operationExpr?: OperationExpr })._operationExpr;
    if (operationExpr) {
      const allRefs = collectColumnRefs(operationExpr);
      for (const ref of allRefs) {
        refsColumns.set(`${ref.table}.${ref.column}`, {
          table: ref.table,
          column: ref.column,
        });
      }
    } else {
      // column is ColumnBuilder - TypeScript can't narrow properly
      const col = column as unknown as { table?: string; column?: string };
      if (col.table && col.column) {
        refsColumns.set(`${col.table}.${col.column}`, {
          table: col.table,
          column: col.column,
        });
      }
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
      // whereLeft is ColumnBuilder - TypeScript can't narrow properly
      const colBuilder = whereLeft as unknown as { table?: string; column?: string };
      if (colBuilder.table && colBuilder.column) {
        refsColumns.set(`${colBuilder.table}.${colBuilder.column}`, {
          table: colBuilder.table,
          column: colBuilder.column,
        });
      }
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
        // orderByExpr is ColumnBuilder - TypeScript can't narrow properly
        const colBuilder = orderByExpr as unknown as { table?: string; column?: string };
        if (colBuilder.table && colBuilder.column) {
          refsColumns.set(`${colBuilder.table}.${colBuilder.column}`, {
            table: colBuilder.table,
            column: colBuilder.column,
          });
        }
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
      // TypeScript can't narrow ColumnBuilder properly
      const col = column as unknown as {
        table?: string;
        column?: string;
        _operationExpr?: OperationExpr;
      };
      if (!col.table || !col.column) {
        // This is a placeholder column for an include - skip it
        return [alias, `include:${alias}`];
      }
      const operationExpr = col._operationExpr;
      if (operationExpr) {
        return [alias, `operation:${operationExpr.method}`];
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
    const operationExpr = (column as { _operationExpr?: OperationExpr })._operationExpr;
    if (operationExpr) {
      if (operationExpr.returns.kind === 'typeId') {
        projectionTypes[alias] = operationExpr.returns.type;
      } else if (operationExpr.returns.kind === 'builtin') {
        projectionTypes[alias] = operationExpr.returns.type;
      }
    } else {
      // TypeScript can't narrow ColumnBuilder properly
      const col = column as unknown as { columnMeta?: { type?: string } };
      const columnMeta = col.columnMeta;
      if (columnMeta?.type) {
        projectionTypes[alias] = columnMeta.type;
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
      // Use columnMeta.type directly as typeId (already canonicalized)
      // TypeScript can't narrow ColumnBuilder properly
      const col = column as unknown as { columnMeta?: { type?: string } };
      const columnMeta = col.columnMeta;
      if (columnMeta?.type) {
        projectionCodecs[alias] = columnMeta.type;
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
