import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { SqlOperationEntry } from '@prisma-next/sql-operations';
import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  OperationExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
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

  const opsByCodecId = new Map<string, [string, SqlOperationEntry][]>();
  for (const [name, entry] of Object.entries(context.queryOperations.entries())) {
    const selfCodecId = entry.args[0]?.codecId;
    if (selfCodecId) {
      let existing = opsByCodecId.get(selfCodecId);
      if (!existing) {
        existing = [];
        opsByCodecId.set(selfCodecId, existing);
      }
      existing.push([name, entry]);
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
      const traits = resolveFieldTraits(contract, modelName, prop, context);
      const codecId = resolveFieldCodecId(contract, tableName, columnName);
      const operations = codecId ? (opsByCodecId.get(codecId) ?? []) : [];
      return createScalarFieldAccessor(tableName, columnName, codecId, traits, operations, context);
    },
  });
}

function resolveFieldTraits(
  contract: Contract<SqlStorage>,
  modelName: string,
  fieldName: string,
  context: ExecutionContext,
): readonly string[] {
  const fieldType = modelOf(contract, modelName)?.fields?.[fieldName]?.type;
  const codecId = fieldType?.kind === 'scalar' ? fieldType.codecId : undefined;
  if (!codecId) return [];
  return context.codecs.traitsOf(codecId);
}

function resolveFieldCodecId(
  contract: Contract<SqlStorage>,
  tableName: string,
  columnName: string,
): string | undefined {
  const table = contract.storage.tables?.[tableName];
  return table?.columns?.[columnName]?.codecId;
}

function createScalarFieldAccessor(
  tableName: string,
  columnName: string,
  codecId: string | undefined,
  traits: readonly string[],
  operations: ReadonlyArray<[string, SqlOperationEntry]>,
  context: ExecutionContext,
): Partial<ComparisonMethodFns<unknown>> {
  const column = ColumnRef.of(tableName, columnName);
  const methods: Record<string, unknown> = {};

  for (const [name, meta] of Object.entries(COMPARISON_METHODS_META)) {
    if (meta.traits.some((t) => !traits.includes(t))) {
      continue;
    }
    methods[name] = meta.create(column, codecId);
  }

  for (const [name, entry] of operations) {
    methods[name] = createExtensionMethodFactory(column, name, entry, context);
  }

  return methods as Partial<ComparisonMethodFns<unknown>>;
}

function createExtensionMethodFactory(
  column: ColumnRef,
  methodName: string,
  entry: SqlOperationEntry,
  context: ExecutionContext,
): (...args: unknown[]) => Partial<ComparisonMethodFns<unknown>> {
  return (...args: unknown[]) => {
    const userArgSpecs = entry.args.slice(1);
    const astArgs = userArgSpecs.map((argSpec, i) => {
      return ParamRef.of(args[i], { codecId: argSpec.codecId });
    });

    const opExpr = new OperationExpr({
      method: methodName,
      self: column,
      args: astArgs,
      returns: entry.returns,
      lowering: entry.lowering,
    });

    const returnTraits = context.codecs.traitsOf(entry.returns.codecId);
    const methods: Record<string, unknown> = {};

    for (const [resultMethodName, meta] of Object.entries(COMPARISON_METHODS_META)) {
      if (meta.traits.some((t) => !returnTraits.includes(t))) {
        continue;
      }
      methods[resultMethodName] = meta.create(opExpr, entry.returns.codecId);
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
    if (!fieldAccessor) {
      continue;
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
