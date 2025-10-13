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
  const childFields = Object.entries(include.child.select?.fields ?? {})
    .map(([alias, col]) => `'${alias}', ${col.name}`)
    .join(', ');

  // Create FK match condition
  const fkMatch = include.relation.on.parentCols
    .map((parentCol, i) => {
      const childCol = include.relation.on.childCols[i];
      return `${include.child.from}.${childCol} = ${parentAst.from}.${parentCol}`;
    })
    .join(' AND ');

  // Build child WHERE clause
  let childWhere = fkMatch;
  if (include.child.where) {
    childWhere += ` AND ${compileChildWhere(include.child.where)}`;
  }

  // Build ORDER BY clause
  let orderByClause = '';
  if (include.child.orderBy && include.child.orderBy.length > 0) {
    const orderBy = include.child.orderBy
      .map((order) => `${include.child.from}.${order.field} ${order.direction}`)
      .join(', ');
    orderByClause = ` ORDER BY ${orderBy}`;
  }

  // Build LIMIT clause
  let limitClause = '';
  if (include.child.limit) {
    limitClause = ` LIMIT ${include.child.limit.count}`;
  }

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
                    fields: Object.fromEntries(
                      Object.entries(include.child.select?.fields ?? {}).map(([alias, col]) => [
                        alias,
                        { kind: 'column', name: col.name },
                      ]),
                    ),
                  },
                ],
              },
            },
          ],
          where: childWhere
            ? { type: 'where', condition: { type: 'eq', field: '1', value: 1 } }
            : undefined,
          orderBy: include.child.orderBy,
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
          expr: { kind: 'column', name: col.name },
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
  const join: JoinClause = {
    type: 'leftJoin',
    table: include.child.from,
    alias: include.alias,
    on: {
      type: 'literal',
      value: include.relation.on.parentCols
        .map((parentCol, i) => {
          const childCol = include.relation.on.childCols[i];
          return `${include.alias}.${childCol} = ${parentAst.from}.${parentCol}`;
        })
        .join(' AND '),
    },
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
          expr: { kind: 'column', name: col.name },
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
