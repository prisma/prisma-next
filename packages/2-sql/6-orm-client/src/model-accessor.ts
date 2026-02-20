import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import type {
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  LiteralExpr,
  SelectAst,
  WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import { and, not } from './filters';
import type { ComparisonMethods, ModelAccessor, RelationFilterAccessor } from './types';

const COMPARISON_OPS: ReadonlyArray<BinaryExpr['op']> = [
  'eq',
  'neq',
  'gt',
  'lt',
  'gte',
  'lte',
  'like',
  'ilike',
  'in',
  'notIn',
];

interface RelationMeta {
  readonly to?: string;
  readonly model?: string;
  readonly on?: {
    readonly parentCols?: readonly string[];
    readonly childCols?: readonly string[];
  };
}

type RelationPredicateInput<TContract extends SqlContract<SqlStorage>, ModelName extends string> =
  | ((model: ModelAccessor<TContract, ModelName>) => WhereExpr)
  | Record<string, unknown>;

/**
 * Creates a Proxy-based model accessor for use inside `where()` callbacks.
 *
 * Accessing a field returns scalar comparison methods, and accessing a relation
 * returns quantifier methods (`some`, `every`, `none`) that compile to EXISTS
 * subqueries.
 */
export function createModelAccessor<
  TContract extends SqlContract<SqlStorage>,
  ModelName extends string,
>(contract: TContract, modelName: ModelName): ModelAccessor<TContract, ModelName> {
  const fieldToColumn = contract.mappings.fieldToColumn?.[modelName] ?? {};
  const tableName = resolveModelTableName(contract, modelName);
  const tableRelations = (contract.relations?.[tableName] ?? {}) as Record<string, RelationMeta>;

  return new Proxy({} as ModelAccessor<TContract, ModelName>, {
    get(_target, prop: string | symbol): unknown {
      if (typeof prop !== 'string') {
        return undefined;
      }

      const relation = tableRelations[prop];
      if (relation) {
        return createRelationFilterAccessor(contract, modelName, tableName, relation);
      }

      const columnName = fieldToColumn[prop] ?? prop;
      return createScalarFieldAccessor(tableName, columnName);
    },
  });
}

function createScalarFieldAccessor(
  tableName: string,
  columnName: string,
): ComparisonMethods<unknown> {
  const left: ColumnRef = {
    kind: 'col',
    table: tableName,
    column: columnName,
  };

  const methods: Partial<ComparisonMethods<unknown>> = {};
  for (const op of COMPARISON_OPS) {
    if (op === 'in' || op === 'notIn') {
      methods[op] = ((values: readonly unknown[]): BinaryExpr => ({
        kind: 'bin',
        op,
        left,
        right: {
          kind: 'listLiteral',
          values: values.map(
            (value): LiteralExpr => ({
              kind: 'literal',
              value,
            }),
          ),
        },
      })) as ComparisonMethods<unknown>[typeof op];
      continue;
    }

    methods[op] = ((value: unknown): BinaryExpr => ({
      kind: 'bin',
      op,
      left,
      right: {
        kind: 'literal',
        value,
      },
    })) as ComparisonMethods<unknown>[typeof op];
  }

  methods.isNull = () => ({
    kind: 'nullCheck',
    expr: left,
    isNull: true,
  });
  methods.isNotNull = () => ({
    kind: 'nullCheck',
    expr: left,
    isNull: false,
  });
  methods.asc = () => ({
    column: columnName,
    direction: 'asc',
  });
  methods.desc = () => ({
    column: columnName,
    direction: 'desc',
  });

  return methods as ComparisonMethods<unknown>;
}

function createRelationFilterAccessor<
  TContract extends SqlContract<SqlStorage>,
  ParentModelName extends string,
>(
  contract: TContract,
  parentModelName: ParentModelName,
  parentTableName: string,
  relation: RelationMeta,
): RelationFilterAccessor<TContract, string> {
  const relatedModelName = resolveRelatedModelName(relation);
  if (!relatedModelName) {
    throw new Error(
      `Relation metadata for model "${parentModelName}" is missing the "to" model reference`,
    );
  }
  const relatedTableName = resolveModelTableName(contract, relatedModelName);

  const relationAccessor: RelationFilterAccessor<TContract, string> = {
    some: (predicate) =>
      createExistsExpr(contract, parentTableName, relatedModelName, relatedTableName, relation, {
        mode: 'some',
        predicate,
      }),
    every: (predicate) =>
      createExistsExpr(contract, parentTableName, relatedModelName, relatedTableName, relation, {
        mode: 'every',
        predicate,
      }),
    none: (predicate) =>
      createExistsExpr(contract, parentTableName, relatedModelName, relatedTableName, relation, {
        mode: 'none',
        predicate,
      }),
  };

  return relationAccessor;
}

function createExistsExpr<TContract extends SqlContract<SqlStorage>>(
  contract: TContract,
  parentTableName: string,
  relatedModelName: string,
  relatedTableName: string,
  relation: RelationMeta,
  options: {
    readonly mode: 'some' | 'every' | 'none';
    readonly predicate?: RelationPredicateInput<TContract, string>;
  },
): ExistsExpr {
  const joinWhere = buildJoinWhere(parentTableName, relatedTableName, relation);
  const childWhere = toRelationWhereExpr(contract, relatedModelName, options.predicate);

  let subqueryWhere = joinWhere;
  let existsNot = false;

  if (options.mode === 'every') {
    existsNot = true;
    if (childWhere) {
      subqueryWhere = and(joinWhere, not(childWhere));
    }
  } else if (options.mode === 'none') {
    existsNot = true;
    if (childWhere) {
      subqueryWhere = and(joinWhere, childWhere);
    }
  } else if (childWhere) {
    subqueryWhere = and(joinWhere, childWhere);
  }

  const selectProjectionColumn = firstChildColumn(relation) ?? 'id';
  const subquery: SelectAst = {
    kind: 'select',
    from: {
      kind: 'table',
      name: relatedTableName,
    },
    project: [
      {
        alias: '_exists',
        expr: {
          kind: 'col',
          table: relatedTableName,
          column: selectProjectionColumn,
        },
      },
    ],
    where: subqueryWhere,
  };

  return {
    kind: 'exists',
    not: existsNot,
    subquery,
  };
}

function toRelationWhereExpr<TContract extends SqlContract<SqlStorage>>(
  contract: TContract,
  relatedModelName: string,
  predicate?: RelationPredicateInput<TContract, string>,
): WhereExpr | undefined {
  if (!predicate) {
    return undefined;
  }

  const accessor = createModelAccessor(contract, relatedModelName);

  if (typeof predicate === 'function') {
    return predicate(accessor);
  }

  const exprs: WhereExpr[] = [];
  for (const [fieldName, value] of Object.entries(predicate)) {
    if (value === undefined) {
      continue;
    }

    const fieldAccessor = (accessor as Record<string, ComparisonMethods<unknown>>)[fieldName];
    if (!fieldAccessor) {
      continue;
    }

    if (value === null) {
      exprs.push(fieldAccessor.isNull());
      continue;
    }

    exprs.push(fieldAccessor.eq(value));
  }

  if (exprs.length === 0) {
    return undefined;
  }

  return exprs.length === 1 ? exprs[0] : and(...exprs);
}

function buildJoinWhere(
  parentTableName: string,
  childTableName: string,
  relation: RelationMeta,
): WhereExpr {
  const parentCols = relation.on?.parentCols ?? [];
  const childCols = relation.on?.childCols ?? [];

  const joinExprs: WhereExpr[] = [];
  const count = Math.min(parentCols.length, childCols.length);

  for (let i = 0; i < count; i++) {
    const parentCol = parentCols[i];
    const childCol = childCols[i];
    if (!parentCol || !childCol) {
      continue;
    }

    joinExprs.push({
      kind: 'bin',
      op: 'eq',
      left: {
        kind: 'col',
        table: childTableName,
        column: childCol,
      },
      right: {
        kind: 'col',
        table: parentTableName,
        column: parentCol,
      },
    });
  }

  if (joinExprs.length === 0) {
    throw new Error('Relation metadata is missing join columns');
  }

  return joinExprs.length === 1 ? joinExprs[0]! : and(...joinExprs);
}

function firstChildColumn(relation: RelationMeta): string | undefined {
  const childCols = relation.on?.childCols;
  if (!childCols || childCols.length === 0) {
    return undefined;
  }
  return childCols[0];
}

function resolveRelatedModelName(relation: RelationMeta): string | undefined {
  return relation.to ?? relation.model;
}

function resolveModelTableName<TContract extends SqlContract<SqlStorage>>(
  contract: TContract,
  modelName: string,
): string {
  const mapped = contract.mappings.modelToTable?.[modelName];
  if (mapped) {
    return mapped;
  }

  const modelTable = contract.models?.[modelName]?.storage?.table;
  if (modelTable) {
    return modelTable;
  }

  return modelName;
}
