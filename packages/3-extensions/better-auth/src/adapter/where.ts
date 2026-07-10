import { and, or } from '@prisma-next/sql-orm-client';
import type { AnyExpression, OrderByItem } from '@prisma-next/sql-relational-core/ast';
import { blindCast } from '@prisma-next/utils/casts';
import type { CleanedWhere } from 'better-auth/adapters';
import type { AdapterFieldComparators, AdapterModelAccessor } from './db-surface';
import { invalidOperatorValue, unsupportedOperator, unsupportedWhereMode } from './errors';
import { assertKnownField, type SpaceModelName } from './model-map';

/** Escapes LIKE pattern metacharacters so user values match literally. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}

function comparatorsFor(
  accessor: AdapterModelAccessor,
  model: string,
  spaceModel: SpaceModelName,
  field: string,
): AdapterFieldComparators {
  assertKnownField(model, spaceModel, field);
  const value = accessor[field];
  if (typeof value !== 'object' || value === null) {
    return {};
  }
  return blindCast<
    AdapterFieldComparators,
    'the accessor value for a contract-validated scalar field is the trait-gated comparator object; relation names are not model fields and are rejected by assertKnownField'
  >(value);
}

/**
 * `CleanedWhere` is `Required<Where>`, but better-auth declares its optional
 * members as explicit `| undefined` unions, so `Required<>` does not remove
 * `undefined` at the type level. The factory guarantees the defaults at
 * runtime; this normalization pins them for the type system too.
 */
interface NormalizedClause {
  readonly field: string;
  readonly operator: string;
  readonly connector: 'AND' | 'OR';
  readonly mode: 'sensitive' | 'insensitive';
  readonly value: CleanedWhere['value'];
}

function normalizeClause(clause: CleanedWhere): NormalizedClause {
  return {
    field: clause.field,
    operator: clause.operator ?? 'eq',
    connector: clause.connector ?? 'AND',
    mode: clause.mode ?? 'sensitive',
    value: clause.value,
  };
}

function requireStringValue(clause: NormalizedClause, model: string): string {
  if (typeof clause.value !== 'string') {
    throw invalidOperatorValue(model, clause.field, clause.operator, 'a string value');
  }
  return clause.value;
}

function requireListValue(clause: NormalizedClause, model: string): readonly unknown[] {
  if (!Array.isArray(clause.value)) {
    throw invalidOperatorValue(model, clause.field, clause.operator, 'an array value');
  }
  return clause.value;
}

function clauseExpression(
  clause: NormalizedClause,
  accessor: AdapterModelAccessor,
  model: string,
  spaceModel: SpaceModelName,
): AnyExpression {
  const { field, operator, value } = clause;
  const comparators = comparatorsFor(accessor, model, spaceModel, field);

  if (clause.mode === 'insensitive') {
    throw unsupportedWhereMode(model, field, operator);
  }

  const require = <M>(method: M | undefined): M => {
    if (method === undefined) {
      throw unsupportedOperator(model, field, operator);
    }
    return method;
  };

  switch (operator) {
    case 'eq':
      return value === null
        ? require(comparators.isNull).call(comparators)
        : require(comparators.eq).call(comparators, value);
    case 'ne':
      return value === null
        ? require(comparators.isNotNull).call(comparators)
        : require(comparators.neq).call(comparators, value);
    case 'lt':
      return require(comparators.lt).call(comparators, value);
    case 'lte':
      return require(comparators.lte).call(comparators, value);
    case 'gt':
      return require(comparators.gt).call(comparators, value);
    case 'gte':
      return require(comparators.gte).call(comparators, value);
    case 'in':
      return require(comparators.in).call(comparators, requireListValue(clause, model));
    case 'not_in':
      return require(comparators.notIn).call(comparators, requireListValue(clause, model));
    case 'contains':
      return require(comparators.like).call(
        comparators,
        `%${escapeLikePattern(requireStringValue(clause, model))}%`,
      );
    case 'starts_with':
      return require(comparators.like).call(
        comparators,
        `${escapeLikePattern(requireStringValue(clause, model))}%`,
      );
    case 'ends_with':
      return require(comparators.like).call(
        comparators,
        `%${escapeLikePattern(requireStringValue(clause, model))}`,
      );
    default:
      throw unsupportedOperator(model, field, operator);
  }
}

/**
 * Translates BetterAuth's cleaned where clauses into one typed ORM
 * expression. Clauses fold left-to-right; each clause's own `connector`
 * decides whether it ORs or ANDs onto the accumulated expression —
 * mirroring the semantics of BetterAuth's reference adapters.
 */
export function buildWhereExpression(
  where: readonly CleanedWhere[],
  accessor: AdapterModelAccessor,
  model: string,
  spaceModel: SpaceModelName,
): AnyExpression | undefined {
  const [firstClause, ...rest] = where.map(normalizeClause);
  if (firstClause === undefined) {
    return undefined;
  }
  let expression = clauseExpression(firstClause, accessor, model, spaceModel);
  for (const clause of rest) {
    const clauseExpr = clauseExpression(clause, accessor, model, spaceModel);
    expression =
      clause.connector === 'OR' ? or(expression, clauseExpr) : and(expression, clauseExpr);
  }
  return expression;
}

/** Builds the `orderBy` selector for a BetterAuth `sortBy` request. */
export function buildOrderBySelector(
  sortBy: { field: string; direction: 'asc' | 'desc' },
  model: string,
  spaceModel: SpaceModelName,
): (accessor: AdapterModelAccessor) => OrderByItem {
  return (accessor) => {
    const comparators = comparatorsFor(accessor, model, spaceModel, sortBy.field);
    const method = sortBy.direction === 'asc' ? comparators.asc : comparators.desc;
    if (method === undefined) {
      throw unsupportedOperator(model, sortBy.field, `sortBy:${sortBy.direction}`);
    }
    return method.call(comparators);
  };
}
