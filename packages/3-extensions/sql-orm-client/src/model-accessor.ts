import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlOperationEntry } from '@prisma-next/sql-operations';
import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import type { Expression, ScopeField } from '@prisma-next/sql-relational-core/expression';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import {
  getFieldToColumnMap,
  modelOf,
  resolveFieldToColumn,
  resolveModelTableName,
} from './collection-contract';
import { and, not } from './filters';
import {
  COMPARISON_METHODS_META,
  type ComparisonMethodFns,
  type ModelAccessor,
  type RelationFilterAccessor,
} from './types';

interface RelationMeta {
  readonly to: string;
  readonly cardinality?: string;
  readonly on?: {
    readonly localFields?: readonly string[];
    readonly targetFields?: readonly string[];
  };
}

type RelationPredicateInput<TContract extends Contract<SqlStorage>, ModelName extends string> =
  | ((model: ModelAccessor<TContract, ModelName>) => AnyExpression)
  | Record<string, unknown>;

type NamedOp = readonly [name: string, entry: SqlOperationEntry];

export function createModelAccessor<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
>(context: ExecutionContext<TContract>, modelName: ModelName): ModelAccessor<TContract, ModelName> {
  const contract = context.contract;
  const fieldToColumn = getFieldToColumnMap(contract, modelName);
  const tableName = resolveModelTableName(contract, modelName);
  const modelRelations = (modelOf(contract, modelName)?.relations ?? {}) as Record<
    string,
    RelationMeta
  >;

  const opsByCodecId = new Map<string, NamedOp[]>();

  function registerOp(codecId: string, op: NamedOp) {
    let existing = opsByCodecId.get(codecId);
    if (!existing) {
      existing = [];
      opsByCodecId.set(codecId, existing);
    }
    existing.push(op);
  }

  for (const [name, entry] of Object.entries(context.queryOperations.entries())) {
    const op: NamedOp = [name, entry];
    const self = entry.self;
    if (!self) continue;
    if (self.codecId !== undefined) {
      registerOp(self.codecId, op);
    } else if (self.traits !== undefined) {
      for (const codec of context.codecs.values()) {
        const codecTraits: readonly string[] = codec.traits ?? [];
        if (self.traits.every((t) => codecTraits.includes(t))) {
          registerOp(codec.id, op);
        }
      }
    }
  }

  return new Proxy({} as ModelAccessor<TContract, ModelName>, {
    get(_target, prop: string | symbol): unknown {
      if (typeof prop !== 'string') {
        return undefined;
      }

      const relation = modelRelations[prop];
      if (relation) {
        return createRelationFilterAccessor(context, modelName, tableName, relation);
      }

      const columnName = fieldToColumn[prop] ?? prop;
      const column = resolveColumn(contract, tableName, columnName);
      // Unknown fields return `undefined`, matching plain JS object semantics.
      // The `ModelAccessor<TContract, ModelName>` type already rejects typos
      // at compile time for TS consumers, and contexts that iterate accessor
      // keys (e.g. relation-shorthand predicates) can detect missing fields
      // with an `undefined` check and raise their own, domain-specific error.
      if (!column) {
        return undefined;
      }
      const traits = context.codecs.traitsOf(column.codecId);
      const operations = opsByCodecId.get(column.codecId) ?? [];
      return createScalarFieldAccessor(
        tableName,
        columnName,
        column.codecId,
        column.nullable,
        traits,
        operations,
        context,
      );
    },
  });
}

function resolveColumn(
  contract: Contract<SqlStorage>,
  tableName: string,
  columnName: string,
): { readonly codecId: string; readonly nullable: boolean } | undefined {
  const column = contract.storage.tables?.[tableName]?.columns?.[columnName];
  if (!column) return undefined;
  return { codecId: column.codecId, nullable: column.nullable };
}

function createScalarFieldAccessor(
  tableName: string,
  columnName: string,
  codecId: string,
  nullable: boolean,
  traits: readonly string[],
  operations: readonly NamedOp[],
  context: ExecutionContext,
): Partial<ComparisonMethodFns<unknown>> {
  const column = ColumnRef.of(tableName, columnName);
  const comparisonEntries: Array<[string, unknown]> = [];
  for (const [name, meta] of Object.entries(COMPARISON_METHODS_META)) {
    if (meta.traits.some((t) => !traits.includes(t))) continue;
    comparisonEntries.push([name, meta.create(column, codecId)]);
  }

  const accessor = {
    returnType: { codecId, nullable },
    buildAst: () => column,
    ...Object.fromEntries(comparisonEntries),
  } as Expression<ScopeField> & Record<string, unknown>;

  for (const [name, entry] of operations) {
    accessor[name] = createExtensionMethodFactory(accessor, entry, context);
  }

  return accessor as Partial<ComparisonMethodFns<unknown>>;
}

function createExtensionMethodFactory(
  selfExpr: Expression<ScopeField>,
  entry: SqlOperationEntry,
  context: ExecutionContext,
): (...args: unknown[]) => unknown {
  return (...args: unknown[]) => {
    // `entry.impl` is typed `(...args: never[]) => QueryOperationReturn` —
    // `never[]` args block direct invocation with unknown values, and the
    // declared return omits `buildAst` (sql-contract intentionally doesn't
    // depend on relational-core). Cast here to the practical shape: authors
    // always return Expression<ScopeField> via `buildOperation`.
    const impl = entry.impl as (self: unknown, ...args: unknown[]) => Expression<ScopeField>;
    const result = impl(selfExpr, ...args);
    const returnCodecId = result.returnType.codecId;
    const returnTraits = context.codecs.traitsOf(returnCodecId);
    const isPredicate = returnTraits.includes('boolean');

    if (isPredicate) {
      return result.buildAst();
    }

    const resultAst = result.buildAst();
    const methods: Record<string, unknown> = {};
    for (const [resultMethodName, meta] of Object.entries(COMPARISON_METHODS_META)) {
      if (meta.traits.some((t) => !returnTraits.includes(t))) continue;
      methods[resultMethodName] = meta.create(resultAst, returnCodecId);
    }
    return methods;
  };
}

function createRelationFilterAccessor<
  TContract extends Contract<SqlStorage>,
  ParentModelName extends string,
>(
  context: ExecutionContext<TContract>,
  parentModelName: ParentModelName,
  parentTableName: string,
  relation: RelationMeta,
): RelationFilterAccessor<TContract, string> {
  const relatedTableName = resolveModelTableName(context.contract, relation.to);

  const relationAccessor: RelationFilterAccessor<TContract, string> = {
    some: (predicate) =>
      buildExistsExpr(context, parentModelName, parentTableName, relatedTableName, relation, {
        mode: 'some',
        predicate,
      }),
    every: (predicate) =>
      buildExistsExpr(context, parentModelName, parentTableName, relatedTableName, relation, {
        mode: 'every',
        predicate,
      }),
    none: (predicate) =>
      buildExistsExpr(context, parentModelName, parentTableName, relatedTableName, relation, {
        mode: 'none',
        predicate,
      }),
  };

  return relationAccessor;
}

function buildExistsExpr<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  parentModelName: string,
  parentTableName: string,
  relatedTableName: string,
  relation: RelationMeta,
  options: {
    readonly mode: 'some' | 'every' | 'none';
    readonly predicate: RelationPredicateInput<TContract, string> | undefined;
  },
): AnyExpression {
  const joinWhere = buildJoinWhere(
    context.contract,
    parentModelName,
    parentTableName,
    relatedTableName,
    relation,
  );
  const childWhere = toRelationWhereExpr(context, relation.to, options.predicate);

  let subqueryWhere = joinWhere;
  let existsNot = false;

  if (options.mode === 'every') {
    if (!childWhere) {
      return AndExpr.true();
    }
    existsNot = true;
    subqueryWhere = and(joinWhere, not(childWhere));
  } else if (options.mode === 'none') {
    existsNot = true;
    if (childWhere) {
      subqueryWhere = and(joinWhere, childWhere);
    }
  } else if (childWhere) {
    subqueryWhere = and(joinWhere, childWhere);
  }

  const selectProjectionColumn = firstTargetColumn(context.contract, relation) ?? 'id';
  const subquery = SelectAst.from(TableSource.named(relatedTableName))
    .withProjection([
      ProjectionItem.of('_exists', ColumnRef.of(relatedTableName, selectProjectionColumn)),
    ])
    .withWhere(subqueryWhere);

  return existsNot ? ExistsExpr.notExists(subquery) : ExistsExpr.exists(subquery);
}

function toRelationWhereExpr<TContract extends Contract<SqlStorage>>(
  context: ExecutionContext<TContract>,
  relatedModelName: string,
  predicate: RelationPredicateInput<TContract, string> | undefined,
): AnyExpression | undefined {
  if (!predicate) {
    return undefined;
  }

  // Both callback and shorthand paths use the trait-gated accessor
  const accessor = createModelAccessor(context, relatedModelName);

  if (typeof predicate === 'function') {
    return predicate(accessor);
  }

  // Shorthand object — skip fields without eq
  const exprs: AnyExpression[] = [];
  for (const [fieldName, value] of Object.entries(predicate)) {
    if (value === undefined) {
      continue;
    }

    const fieldAccessor = (accessor as Record<string, Partial<ComparisonMethodFns<unknown>>>)[
      fieldName
    ];
    // Unknown field in the shorthand predicate — the Proxy returns undefined
    // for fields the contract doesn't declare. Surface it explicitly: silent
    // skip would drop user intent (e.g. a typo'd `nmae: 'Alice'` filter would
    // match every row).
    if (!fieldAccessor) {
      throw new Error(
        `Shorthand filter on "${relatedModelName}.${fieldName}": field is not defined on the model`,
      );
    }

    if (value === null) {
      if (!fieldAccessor.isNull) {
        throw new Error(
          `Shorthand filter on "${relatedModelName}.${fieldName}": isNull is unexpectedly missing — this is a bug in trait gating`,
        );
      }
      exprs.push(fieldAccessor.isNull());
      continue;
    }

    if (!fieldAccessor.eq) {
      throw new Error(
        `Shorthand filter on "${relatedModelName}.${fieldName}": field does not support equality comparisons`,
      );
    }
    exprs.push(fieldAccessor.eq(value));
  }

  if (exprs.length === 0) {
    return undefined;
  }

  return exprs.length === 1 ? exprs[0] : and(...exprs);
}

function buildJoinWhere<TContract extends Contract<SqlStorage>>(
  contract: TContract,
  parentModelName: string,
  parentTableName: string,
  relatedTableName: string,
  relation: RelationMeta,
): AnyExpression {
  const localFields = relation.on?.localFields ?? [];
  const targetFields = relation.on?.targetFields ?? [];

  const joinExprs: AnyExpression[] = [];
  const count = Math.min(localFields.length, targetFields.length);

  for (let i = 0; i < count; i++) {
    const localField = localFields[i];
    const targetField = targetFields[i];
    if (!localField || !targetField) {
      continue;
    }

    const localColumn = resolveFieldToColumn(contract, parentModelName, localField);
    const targetColumn = resolveFieldToColumn(contract, relation.to, targetField);

    joinExprs.push(
      BinaryExpr.eq(
        ColumnRef.of(relatedTableName, targetColumn),
        ColumnRef.of(parentTableName, localColumn),
      ),
    );
  }

  if (joinExprs.length === 0) {
    throw new Error('Relation metadata is missing join columns');
  }

  const firstExpr = joinExprs[0];
  if (joinExprs.length === 1 && firstExpr !== undefined) {
    return firstExpr;
  }

  return and(...joinExprs);
}

function firstTargetColumn<TContract extends Contract<SqlStorage>>(
  contract: TContract,
  relation: RelationMeta,
): string | undefined {
  const targetFields = relation.on?.targetFields;
  const firstField = targetFields?.[0];
  if (!firstField) {
    return undefined;
  }
  return resolveFieldToColumn(contract, relation.to, firstField);
}
