import type { BinaryExpr, WhereExpr } from '@prisma-next/sql-relational-core/ast';
import { type CompiledQuery, sql } from 'kysely';
import { applyWhereFilters } from './kysely-compiler-query-state';
import { quoteIdentifier, toRawCompiledQuery } from './kysely-compiler-raw';
import { queryCompiler } from './kysely-compiler-shared';
import type { AggregateSelector } from './types';

export const GROUPED_HAVING_TABLE = '__orm_having';

export function compileAggregate(
  tableName: string,
  filters: readonly WhereExpr[],
  aggregateSpec: Record<string, AggregateSelector<unknown>>,
): CompiledQuery<Record<string, unknown>> {
  const entries = Object.entries(aggregateSpec);
  if (entries.length === 0) {
    throw new Error('aggregate() requires at least one aggregation selector');
  }

  let qb = queryCompiler.selectFrom(tableName);
  qb = applyWhereFilters(qb, filters);
  const selections = entries.map(([alias, selector]) =>
    buildAggregateSelection(tableName, selector, alias),
  );

  return qb.select(selections as never).compile() as CompiledQuery<Record<string, unknown>>;
}

export function compileGroupedAggregate(
  tableName: string,
  filters: readonly WhereExpr[],
  groupByColumns: readonly string[],
  aggregateSpec: Record<string, AggregateSelector<unknown>>,
  havingExpr: WhereExpr | undefined,
): CompiledQuery<Record<string, unknown>> {
  if (groupByColumns.length === 0) {
    throw new Error('groupBy() requires at least one field');
  }

  const entries = Object.entries(aggregateSpec);
  if (entries.length === 0) {
    throw new Error('groupBy().aggregate() requires at least one aggregation selector');
  }

  let qb = queryCompiler.selectFrom(tableName);
  qb = applyWhereFilters(qb, filters);
  const groupedSelects = groupByColumns.map((column) => `${tableName}.${column}`);
  const aggregateSelects = entries.map(([alias, selector]) =>
    buildAggregateSelection(tableName, selector, alias),
  );
  qb = qb.select([...groupedSelects, ...aggregateSelects] as never);

  for (const groupColumn of groupByColumns) {
    qb = qb.groupBy(`${tableName}.${groupColumn}`);
  }

  const compiled = qb.compile();
  if (!havingExpr) {
    return compiled as CompiledQuery<Record<string, unknown>>;
  }

  const havingCompiled = compileGroupedHavingExpr(
    havingExpr,
    tableName,
    compiled.parameters.length,
  );
  return toRawCompiledQuery<Record<string, unknown>>(
    `${compiled.sql} having ${havingCompiled.sql}`,
    [...compiled.parameters, ...havingCompiled.parameters],
  );
}

export function compileHavingMetricColumn(
  fn: 'sum' | 'avg' | 'min' | 'max',
  column: string,
): string {
  return `${fn}:${column}`;
}

function buildAggregateSelection(
  tableName: string,
  selector: AggregateSelector<unknown>,
  alias: string,
) {
  if (selector.fn === 'count') {
    return sql<number>`count(*)`.as(alias);
  }

  const column = selector.column;
  if (!column) {
    throw new Error(`Aggregate selector "${selector.fn}" requires a field`);
  }

  const qualifiedColumn = sql.ref(`${tableName}.${column}`);
  if (selector.fn === 'sum') {
    return sql<number | null>`sum(${qualifiedColumn})`.as(alias);
  }
  if (selector.fn === 'avg') {
    return sql<number | null>`avg(${qualifiedColumn})`.as(alias);
  }
  if (selector.fn === 'min') {
    return sql<number | null>`min(${qualifiedColumn})`.as(alias);
  }
  return sql<number | null>`max(${qualifiedColumn})`.as(alias);
}

function compileGroupedHavingExpr(
  expr: WhereExpr,
  tableName: string,
  parameterOffset: number,
): {
  sql: string;
  parameters: readonly unknown[];
} {
  const parameters: unknown[] = [];

  const pushParameter = (value: unknown): string => {
    parameters.push(value);
    return `$${parameterOffset + parameters.length}`;
  };

  const renderRight = (right: BinaryExpr['right'], op: string): string => {
    if (!right || typeof right !== 'object') {
      throw new Error(`Unsupported grouped having right operand for operator "${op}"`);
    }

    const candidate = right as { kind?: string; value?: unknown; values?: readonly unknown[] };
    if (candidate.kind === 'literal') {
      const literalValue = (candidate as { value: unknown }).value;
      if ((op === 'IN' || op === 'NOT IN') && Array.isArray(literalValue)) {
        if (literalValue.length === 0) {
          return '(NULL)';
        }
        return `(${literalValue.map((value) => pushParameter(value)).join(', ')})`;
      }
      return pushParameter(literalValue);
    }

    if (candidate.kind === 'param') {
      throw new Error('ParamRef is not supported in grouped having expressions');
    }

    if (candidate.kind === 'listLiteral') {
      const values = (candidate as { values: readonly { value?: unknown }[] }).values;
      if (values.length === 0) {
        return '(NULL)';
      }
      const rendered = values.map((value) => {
        if (value && typeof value === 'object' && 'value' in value) {
          return pushParameter(value.value);
        }
        return pushParameter(value);
      });
      return `(${rendered.join(', ')})`;
    }

    if (candidate.kind === 'col') {
      const col = candidate as { table: string; column: string };
      if (col.table !== GROUPED_HAVING_TABLE) {
        return `${quoteIdentifier(col.table)}.${quoteIdentifier(col.column)}`;
      }
      return renderHavingMetric(col.column, tableName);
    }

    throw new Error(
      `Unsupported grouped having right operand kind "${candidate.kind ?? 'unknown'}"`,
    );
  };

  const renderExpr = (node: WhereExpr): string => {
    if (node.kind === 'and') {
      if (node.exprs.length === 0) {
        return 'TRUE';
      }
      return `(${node.exprs.map((child) => renderExpr(child)).join(' AND ')})`;
    }

    if (node.kind === 'or') {
      if (node.exprs.length === 0) {
        return 'FALSE';
      }
      return `(${node.exprs.map((child) => renderExpr(child)).join(' OR ')})`;
    }

    if (node.kind === 'nullCheck') {
      if (node.expr.kind !== 'col' || node.expr.table !== GROUPED_HAVING_TABLE) {
        throw new Error('groupBy().having() only supports aggregate metric expressions');
      }
      const metric = renderHavingMetric(node.expr.column, tableName);
      return `${metric} IS ${node.isNull ? '' : 'NOT '}NULL`;
    }

    if (node.kind !== 'bin') {
      throw new Error(`Unsupported grouped having expression kind "${node.kind}"`);
    }

    if (node.left.kind !== 'col' || node.left.table !== GROUPED_HAVING_TABLE) {
      throw new Error('groupBy().having() only supports aggregate metric expressions');
    }

    const operator = mapBinaryOpToSql(node.op);
    const left = renderHavingMetric(node.left.column, tableName);
    const right = renderRight(node.right, operator);
    return `${left} ${operator} ${right}`;
  };

  return {
    sql: renderExpr(expr),
    parameters,
  };
}

function renderHavingMetric(metric: string, tableName: string): string {
  if (metric === 'count') {
    return 'count(*)';
  }

  const [fn, column] = metric.split(':', 2);
  if (!column) {
    throw new Error(`Invalid grouped having metric "${metric}"`);
  }

  if (fn !== 'sum' && fn !== 'avg' && fn !== 'min' && fn !== 'max') {
    throw new Error(`Unsupported grouped having metric "${metric}"`);
  }

  return `${fn}(${quoteIdentifier(tableName)}.${quoteIdentifier(column)})`;
}

function mapBinaryOpToSql(op: string): string {
  switch (op) {
    case 'eq':
      return '=';
    case 'neq':
      return '!=';
    case 'gt':
      return '>';
    case 'lt':
      return '<';
    case 'gte':
      return '>=';
    case 'lte':
      return '<=';
    case 'like':
      return 'LIKE';
    case 'ilike':
      return 'ILIKE';
    case 'in':
      return 'IN';
    case 'notIn':
      return 'NOT IN';
    default:
      throw new Error(`Unsupported grouped having operator "${op}"`);
  }
}
