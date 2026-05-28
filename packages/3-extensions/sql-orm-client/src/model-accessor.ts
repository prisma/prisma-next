import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage, StorageTable } from '@prisma-next/sql-contract/types';
import type { SqlOperationEntry } from '@prisma-next/sql-operations';
import {
  AndExpr,
  type AnyExpression,
  BinaryExpr,
  type CodecRef,
  ColumnRef,
  ExistsExpr,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@prisma-next/sql-relational-core/ast';
import { codecRefForStorageColumn } from '@prisma-next/sql-relational-core/codec-descriptor-registry';
import type { Expression, ScopeField } from '@prisma-next/sql-relational-core/expression';
import type { ExecutionContext } from '@prisma-next/sql-relational-core/query-lane-context';
import {
  getFieldToColumnMap,
  resolveFieldToColumn,
  resolveModelRelations,
  resolveModelTableName,
} from './collection-contract';
import { and, not } from './filters';
import type { ModelAccessor, RelationFilterAccessor } from './types';

/**
 * Trait-gated `asc` / `desc` ordering factories.
 *
 * **Removed by slice 3b** — when the ORM ordering registry lands, the
 * `OrderByModelAccessor` will own these factories and the WHERE accessor
 * will no longer surface them. Until then, they live here so that the
 * single registry-driven loop in `createScalarFieldAccessor` (and the
 * mirror loop in `createExtensionMethodFactory` for non-predicate
 * chained results) can attach `m.field.asc()` / `m.field.desc()`
 * alongside the family-SQL registry's trait-gated predicates.
 *
 * The framework registry intentionally excludes ordering ops (they're
 * an ORM concern, not a SQL-builder one). The `'order'` trait gate
 * here mirrors the gate the deleted `COMPARISON_METHODS_META.asc /
 * .desc` carried so the WHERE-accessor surface is byte-identical for
 * order-trait codecs.
 */
const LEGACY_ORDERING_METHODS = {
  asc: {
    traits: ['order'] as const,
    create: (left: AnyExpression) => () => OrderByItem.asc(left),
  },
  desc: {
    traits: ['order'] as const,
    create: (left: AnyExpression) => () => OrderByItem.desc(left),
  },
} as const;

type ResolvedModelRelation = ReturnType<typeof resolveModelRelations>[string];

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
  const modelRelations = resolveModelRelations(contract, modelName);

  const opsByCodecId = buildOpsByCodecId(context);

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
      const traits = context.codecDescriptors.descriptorFor(column.codecId)?.traits ?? [];
      const operations = opsByCodecId.get(column.codecId) ?? [];
      const codec = codecRefForStorageColumn(contract.storage, tableName, columnName);
      return createScalarFieldAccessor(
        tableName,
        columnName,
        column.codecId,
        column.nullable,
        codec,
        traits,
        operations,
        opsByCodecId,
        context,
      );
    },
  });
}

/**
 * Build the per-codec operations index from the execution context's
 * registry. For each registered operation, walks the contract's codec
 * descriptors and registers the op against every codec id that
 * satisfies its `self` dispatch hint (codec-id match, trait subset, or
 * unconditional `any`).
 *
 * The index is shared by `createScalarFieldAccessor` (column-method
 * synthesis) and `createExtensionMethodFactory` (chained-result
 * synthesis on a non-predicate registry op's return codec).
 */
function buildOpsByCodecId(context: ExecutionContext): Map<string, NamedOp[]> {
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
      for (const descriptor of context.codecDescriptors.values()) {
        const descriptorTraits: readonly string[] = descriptor.traits;
        if (self.traits.every((t) => descriptorTraits.includes(t))) {
          registerOp(descriptor.codecId, op);
        }
      }
    } else if (self.any === true) {
      for (const descriptor of context.codecDescriptors.values()) {
        registerOp(descriptor.codecId, op);
      }
    }
  }

  return opsByCodecId;
}

function resolveColumn(
  contract: Contract<SqlStorage>,
  tableName: string,
  columnName: string,
): { readonly codecId: string; readonly nullable: boolean } | undefined {
  const table = Object.values(contract.storage.namespaces).find(
    (ns) => ns.tables[tableName] !== undefined,
  )?.tables[tableName] as StorageTable | undefined;
  const column = table?.columns?.[columnName];
  if (!column) return undefined;
  return { codecId: column.codecId, nullable: column.nullable };
}

function createScalarFieldAccessor(
  tableName: string,
  columnName: string,
  codecId: string,
  nullable: boolean,
  codec: CodecRef | undefined,
  traits: readonly string[],
  operations: readonly NamedOp[],
  opsByCodecId: ReadonlyMap<string, readonly NamedOp[]>,
  context: ExecutionContext,
): Expression<ScopeField> & Record<string, unknown> {
  const column = ColumnRef.of(tableName, columnName);
  // `codec` may be undefined when the scope was built without contract
  // storage; `ScopeField['codec']` is exact-optional, so we keep the
  // legacy `as` cast rather than threading a conditional spread.
  const accessor = {
    returnType: { codecId, nullable, codec },
    codec,
    buildAst: () => column,
  } as Expression<ScopeField> & Record<string, unknown>;
  attachOperationMethods(accessor, column, traits, operations, opsByCodecId, context);
  return accessor;
}

/**
 * Single registry-driven synthesis loop: attaches each registry op
 * applicable to this codec id as an extension-method factory, then
 * layers on the transient `LEGACY_ORDERING_METHODS` (`asc` / `desc`)
 * gated on the codec's trait set. Shared by `createScalarFieldAccessor`
 * (column accessor) and `createExtensionMethodFactory` (chained-result
 * accessor on a non-predicate op's return codec).
 */
function attachOperationMethods(
  accessor: Expression<ScopeField> & Record<string, unknown>,
  ast: AnyExpression,
  traits: readonly string[],
  operations: readonly NamedOp[],
  opsByCodecId: ReadonlyMap<string, readonly NamedOp[]>,
  context: ExecutionContext,
): void {
  for (const [name, entry] of operations) {
    accessor[name] = createExtensionMethodFactory(accessor, entry, opsByCodecId, context);
  }
  for (const [name, factory] of Object.entries(LEGACY_ORDERING_METHODS)) {
    if (factory.traits.some((t) => !traits.includes(t))) continue;
    accessor[name] = factory.create(ast);
  }
}

function createExtensionMethodFactory(
  selfExpr: Expression<ScopeField>,
  entry: SqlOperationEntry,
  opsByCodecId: ReadonlyMap<string, readonly NamedOp[]>,
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
    const returnTraits = context.codecDescriptors.descriptorFor(returnCodecId)?.traits ?? [];
    const isPredicate = returnTraits.includes('boolean');

    if (isPredicate) {
      return result.buildAst();
    }

    // Non-predicate result: build a sub-accessor whose method surface
    // is sourced from the registry's per-result-codec ops index, layered
    // with `LEGACY_ORDERING_METHODS`. This mirrors the column-accessor
    // synthesis above so the chained surface (e.g.
    // `column.cosineSimilarity(v).gt(0.5)` /
    // `column.cosineSimilarity(v).desc()`) keeps working.
    const resultAst = result.buildAst();
    const returnCodec: CodecRef = { codecId: returnCodecId };
    const subAccessor = {
      returnType: { codecId: returnCodecId, nullable: false, codec: returnCodec },
      codec: returnCodec,
      buildAst: () => resultAst,
    } as Expression<ScopeField> & Record<string, unknown>;
    const resultOps = opsByCodecId.get(returnCodecId) ?? [];
    attachOperationMethods(subAccessor, resultAst, returnTraits, resultOps, opsByCodecId, context);
    return subAccessor;
  };
}

function createRelationFilterAccessor<
  TContract extends Contract<SqlStorage>,
  ParentModelName extends string,
>(
  context: ExecutionContext<TContract>,
  parentModelName: ParentModelName,
  parentTableName: string,
  relation: ResolvedModelRelation,
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
  relation: ResolvedModelRelation,
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

    const fieldAccessor = (accessor as Record<string, unknown>)[fieldName] as
      | {
          eq?: (value: unknown) => AnyExpression;
          isNull?: () => AnyExpression;
        }
      | undefined;
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
  relation: ResolvedModelRelation,
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
  relation: ResolvedModelRelation,
): string | undefined {
  const targetFields = relation.on?.targetFields;
  const firstField = targetFields?.[0];
  if (!firstField) {
    return undefined;
  }
  return resolveFieldToColumn(contract, relation.to, firstField);
}
