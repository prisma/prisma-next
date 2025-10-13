import { QueryAST, ProjectionItem, Expr, JoinClause } from '@prisma/sql';
import { RelationsLowerer, LowerContext } from './types';
import { IncludeNode } from '../ast/types';

export const postgresLowerer: RelationsLowerer = {
  target: 'postgres',

  lowerInclude(parentAst, include, ctx) {
    if (include.relation.cardinality === '1:N' && include.mode === 'nested') {
      return lower1NNested(parentAst, include, ctx);
    } else if (include.relation.cardinality === 'N:1') {
      return lowerN1Flat(parentAst, include, ctx);
    }

    throw new Error(
      `Unsupported include mode: ${include.mode} for cardinality: ${include.relation.cardinality}`,
    );
  },
};

function lower1NNested(parentAst: QueryAST, include: IncludeNode, ctx: LowerContext): QueryAST {
  // Build correlated scalar subquery with json_agg
  // Handle both old format (fields object) and new format (ProjectionItem array)
  let childFields: Record<string, Expr> = {};

  if (include.child.select) {
    if (Array.isArray(include.child.select)) {
      // New format: ProjectionItem[]
      childFields = Object.fromEntries(include.child.select.map((item) => [item.alias, item.expr]));
    } else {
      // Old format: { fields: Record<string, Column> }
      childFields = Object.fromEntries(
        Object.entries(include.child.select.fields ?? {}).map(([alias, col]) => [
          alias,
          { kind: 'column', name: col.name },
        ]),
      );
    }
  }

  // Create FK correlation condition using the new Expr system
  const fkConditions = include.relation.on.parentCols.map((parentCol, i) => {
    const childCol = include.relation.on.childCols[i];
    return {
      kind: 'eq' as const,
      left: { kind: 'column' as const, table: include.child.from, name: childCol },
      right: { kind: 'column' as const, table: parentAst.from, name: parentCol },
    };
  });

  const fkCondition =
    fkConditions.length === 0
      ? undefined
      : fkConditions.length === 1
        ? fkConditions[0]
        : fkConditions.reduce((acc, condition) => ({
            kind: 'and' as const,
            left: acc,
            right: condition,
          }));

  // Create the scalar subquery expression
  const subqueryExpr: Expr = {
    kind: 'call',
    fn: 'COALESCE',
    args: [
      {
        kind: 'subquery',
        query: {
          type: 'select',
          from: include.child.from,
          select: [
            {
              alias: 'agg',
              expr: {
                kind: 'call',
                fn: 'json_agg',
                args: [
                  {
                    kind: 'jsonObject',
                    fields: childFields,
                  },
                ],
              },
            },
          ],
          where: (() => {
            if (!fkCondition) return include.child.where;
            if (!include.child.where) return { type: 'where', condition: fkCondition };

            // Combine FK condition with child WHERE clause using AND
            return {
              type: 'where',
              condition: {
                kind: 'and',
                left: fkCondition,
                right: include.child.where.condition,
              },
            };
          })(),
          // Note: ORDER BY is not supported in json_agg subqueries in PostgreSQL
          // The ordering needs to be handled differently or removed
          limit: include.child.limit,
        },
      },
      { kind: 'literal', value: '[]' },
    ],
  };

  // Add the subquery as a projection item
  const newSelect: ProjectionItem[] = [];

  // Add existing projections
  if (parentAst.select) {
    if (Array.isArray(parentAst.select)) {
      newSelect.push(...parentAst.select);
    } else {
      // Convert old format to new format
      for (const [alias, col] of Object.entries(parentAst.select.fields)) {
        newSelect.push({
          alias,
          expr: { kind: 'column', table: parentAst.from, name: col.name },
        });
      }
    }
  }

  // Add the relation projection
  newSelect.push({
    alias: include.alias,
    expr: subqueryExpr,
  });

  return {
    ...parentAst,
    select: newSelect,
  };
}

function lowerN1Flat(parentAst: QueryAST, include: IncludeNode, ctx: LowerContext): QueryAST {
  // Simple LEFT JOIN
  const fkConditions = include.relation.on.parentCols.map((parentCol, i) => {
    const childCol = include.relation.on.childCols[i];
    return {
      kind: 'eq' as const,
      left: { kind: 'column' as const, table: parentAst.from, name: parentCol },
      right: { kind: 'column' as const, table: include.alias, name: childCol },
    };
  });

  const fkCondition =
    fkConditions.length === 0
      ? undefined
      : fkConditions.length === 1
        ? fkConditions[0]
        : fkConditions.reduce((acc, condition) => ({
            kind: 'and' as const,
            left: acc,
            right: condition,
          }));

  const join: JoinClause = {
    type: 'leftJoin',
    table: include.child.from,
    alias: include.alias,
    on: fkCondition!,
  };

  const newJoins = [...(parentAst.joins ?? []), join];

  // Add aliased child columns to select
  const newSelect: ProjectionItem[] = [];

  // Add existing projections
  if (parentAst.select) {
    if (Array.isArray(parentAst.select)) {
      newSelect.push(...parentAst.select);
    } else {
      // Convert old format to new format
      for (const [alias, col] of Object.entries(parentAst.select.fields)) {
        newSelect.push({
          alias,
          expr: { kind: 'column', table: parentAst.from, name: col.name },
        });
      }
    }
  }

  // Add child columns with prefix
  for (const [alias, col] of Object.entries(include.child.select?.fields ?? {})) {
    newSelect.push({
      alias: `${include.alias}__${alias}`,
      expr: { kind: 'column', table: include.alias, name: col.name },
    });
  }

  return {
    ...parentAst,
    joins: newJoins,
    select: newSelect,
  };
}

// Helper function to compile child WHERE conditions
function compileChildWhere(where: any): string {
  // This is a simplified implementation
  // In a real implementation, you'd need to handle the full expression tree
  return '1=1'; // Placeholder
}
