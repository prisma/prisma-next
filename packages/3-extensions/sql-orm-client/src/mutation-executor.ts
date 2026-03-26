import type { SqlContract, SqlStorage } from '@prisma-next/sql-contract/types';
import {
  BinaryExpr,
  ColumnRef,
  LiteralExpr,
  type WhereExpr,
} from '@prisma-next/sql-relational-core/ast';
import { resolveModelTableName, resolvePrimaryKeyColumn } from './collection-contract';
import {
  acquireRuntimeScope,
  mapModelDataToStorageRow,
  mapStorageRowToModelFields,
} from './collection-runtime';
import { executeQueryPlan } from './execute-query-plan';
import { and, shorthandToWhereExpr } from './filters';
import {
  compileInsertReturning,
  compileSelect,
  compileUpdateCount,
  compileUpdateReturning,
} from './query-plan';
import {
  createRelationMutator,
  isRelationMutationCallback,
  isRelationMutationDescriptor,
} from './relation-mutator';
import type {
  CollectionState,
  MutationCreateInput,
  MutationUpdateInput,
  RelationCardinalityTag,
  RelationMutation,
  RelationMutator,
  RuntimeQueryable,
  RuntimeScope,
} from './types';
import { emptyState } from './types';

interface RelationDefinition {
  readonly relationName: string;
  readonly relatedModelName: string;
  readonly relatedTableName: string;
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly parentCols: readonly string[];
  readonly childCols: readonly string[];
}

interface ParsedRelationMutation {
  readonly relation: RelationDefinition;
  readonly mutation: RelationMutation<SqlContract<SqlStorage>, string>;
}

interface ParsedMutationInput {
  readonly scalarData: Record<string, unknown>;
  readonly relationMutations: readonly ParsedRelationMutation[];
}

export function hasNestedMutationCallbacks(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  data: Record<string, unknown>,
): boolean {
  const relationNames = new Set(
    getRelationDefinitions(contract, modelName).map((relation) => relation.relationName),
  );
  for (const [fieldName, value] of Object.entries(data)) {
    if (!relationNames.has(fieldName)) {
      continue;
    }
    if (isRelationMutationCallback(value)) {
      return true;
    }
  }

  return false;
}

export async function executeNestedCreateMutation(options: {
  contract: SqlContract<SqlStorage>;
  runtime: RuntimeQueryable;
  modelName: string;
  data: MutationCreateInput<SqlContract<SqlStorage>, string>;
}): Promise<Record<string, unknown>> {
  return withMutationScope(options.runtime, async (scope) =>
    createGraph(scope, options.contract, options.modelName, options.data),
  );
}

export async function executeNestedUpdateMutation(options: {
  contract: SqlContract<SqlStorage>;
  runtime: RuntimeQueryable;
  modelName: string;
  filters: readonly WhereExpr[];
  data: MutationUpdateInput<SqlContract<SqlStorage>, string>;
}): Promise<Record<string, unknown> | null> {
  return withMutationScope(options.runtime, async (scope) =>
    updateFirstGraph(scope, options.contract, options.modelName, options.filters, options.data),
  );
}

export function buildPrimaryKeyFilterFromRow(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  row: Record<string, unknown>,
): Record<string, unknown> {
  const tableName = resolveModelTableName(contract, modelName);
  const primaryKeyColumn = resolvePrimaryKeyColumn(contract, tableName);
  const fieldName = toFieldName(contract, modelName, primaryKeyColumn);
  const value = row[fieldName];
  if (value === undefined) {
    throw new Error(
      `Missing primary key field "${fieldName}" while reloading model "${modelName}"`,
    );
  }

  return {
    [fieldName]: value,
  };
}

async function withMutationScope<T>(
  runtime: RuntimeQueryable,
  run: (scope: RuntimeScope) => Promise<T>,
): Promise<T> {
  if (typeof runtime.transaction === 'function') {
    const transaction = await runtime.transaction();
    try {
      const result = await run(transaction);
      if (typeof transaction.commit === 'function') {
        await transaction.commit();
      }
      return result;
    } catch (error) {
      if (typeof transaction.rollback === 'function') {
        await transaction.rollback();
      }
      throw error;
    }
  }

  const { scope, release } = await acquireRuntimeScope(runtime);
  try {
    return await run(scope);
  } finally {
    if (release) {
      await release();
    }
  }
}

async function createGraph(
  scope: RuntimeScope,
  contract: SqlContract<SqlStorage>,
  modelName: string,
  input: MutationCreateInput<SqlContract<SqlStorage>, string>,
): Promise<Record<string, unknown>> {
  const parsed = parseMutationInput(contract, modelName, input);
  const { parentOwned, childOwned } = partitionByOwnership(parsed.relationMutations);

  const scalarData = { ...parsed.scalarData };

  for (const relationMutation of parentOwned) {
    if (relationMutation.mutation.kind === 'disconnect') {
      throw new Error('disconnect() is only supported in update() nested mutations');
    }

    await applyParentOwnedMutation(
      scope,
      contract,
      modelName,
      scalarData,
      relationMutation.relation,
      relationMutation.mutation,
    );
  }

  const parentRow = await insertSingleRow(scope, contract, modelName, scalarData);

  for (const relationMutation of childOwned) {
    if (relationMutation.mutation.kind === 'disconnect') {
      throw new Error('disconnect() is only supported in update() nested mutations');
    }

    await applyChildOwnedMutation(
      scope,
      contract,
      modelName,
      parentRow,
      relationMutation.relation,
      relationMutation.mutation,
    );
  }

  return parentRow;
}

async function updateFirstGraph(
  scope: RuntimeScope,
  contract: SqlContract<SqlStorage>,
  modelName: string,
  filters: readonly WhereExpr[],
  input: MutationUpdateInput<SqlContract<SqlStorage>, string>,
): Promise<Record<string, unknown> | null> {
  const existingRow = await findFirstByFilters(scope, contract, modelName, filters);
  if (!existingRow) {
    return null;
  }

  const parsed = parseMutationInput(contract, modelName, input as Record<string, unknown>);
  const { parentOwned, childOwned } = partitionByOwnership(parsed.relationMutations);

  const scalarData = { ...parsed.scalarData };

  for (const relationMutation of parentOwned) {
    await applyParentOwnedMutation(
      scope,
      contract,
      modelName,
      scalarData,
      relationMutation.relation,
      relationMutation.mutation,
    );
  }

  let parentRow = existingRow;

  const mappedUpdateData = mapModelDataToStorageRow(contract, modelName, scalarData);
  if (Object.keys(mappedUpdateData).length > 0) {
    const pkFilter = buildPrimaryKeyFilterFromRow(contract, modelName, existingRow);
    const pkWhere = shorthandToWhereExpr(
      contract,
      modelName,
      pkFilter as MutationUpdateInput<SqlContract<SqlStorage>, string>,
    );
    if (!pkWhere) {
      throw new Error(`Failed to build primary key filter for model "${modelName}"`);
    }

    const tableName = resolveModelTableName(contract, modelName);
    const compiled = compileUpdateReturning(
      contract,
      tableName,
      mappedUpdateData,
      [pkWhere],
      undefined,
    );
    const updatedRowsRaw = await executeQueryPlan<Record<string, unknown>>(
      scope,
      compiled,
    ).toArray();

    const updatedRaw = updatedRowsRaw[0];
    if (updatedRaw) {
      parentRow = mapStorageRowToModelFields(contract, tableName, updatedRaw);
    }
  }

  for (const relationMutation of childOwned) {
    await applyChildOwnedMutation(
      scope,
      contract,
      modelName,
      parentRow,
      relationMutation.relation,
      relationMutation.mutation,
    );
  }

  return parentRow;
}

function parseMutationInput(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  input: Record<string, unknown>,
): ParsedMutationInput {
  const scalarData: Record<string, unknown> = {};
  const relationDefinitions = new Map(
    getRelationDefinitions(contract, modelName).map((relation) => [
      relation.relationName,
      relation,
    ]),
  );

  const relationMutations: ParsedRelationMutation[] = [];

  for (const [fieldName, value] of Object.entries(input)) {
    const relation = relationDefinitions.get(fieldName);
    if (!relation) {
      scalarData[fieldName] = value;
      continue;
    }

    if (!isRelationMutationCallback(value)) {
      throw new Error(
        `Relation field "${fieldName}" on model "${modelName}" expects a mutator callback`,
      );
    }

    const mutator = createRelationMutator<SqlContract<SqlStorage>, string>();
    const mutation = value(mutator as RelationMutator<SqlContract<SqlStorage>, string>);
    if (!isRelationMutationDescriptor(mutation)) {
      throw new Error(
        `Relation field "${fieldName}" on model "${modelName}" returned an invalid mutation descriptor`,
      );
    }

    relationMutations.push({
      relation,
      mutation,
    });
  }

  return {
    scalarData,
    relationMutations,
  };
}

function partitionByOwnership(relationMutations: readonly ParsedRelationMutation[]): {
  parentOwned: ParsedRelationMutation[];
  childOwned: ParsedRelationMutation[];
} {
  const parentOwned: ParsedRelationMutation[] = [];
  const childOwned: ParsedRelationMutation[] = [];

  for (const relationMutation of relationMutations) {
    if (relationMutation.relation.cardinality === 'N:1') {
      parentOwned.push(relationMutation);
      continue;
    }

    if (relationMutation.relation.cardinality === 'M:N') {
      throw new Error('M:N nested mutations are not supported yet');
    }

    childOwned.push(relationMutation);
  }

  return {
    parentOwned,
    childOwned,
  };
}

async function applyParentOwnedMutation(
  scope: RuntimeScope,
  contract: SqlContract<SqlStorage>,
  parentModelName: string,
  scalarData: Record<string, unknown>,
  relation: RelationDefinition,
  mutation: RelationMutation<SqlContract<SqlStorage>, string>,
): Promise<void> {
  if (mutation.kind === 'disconnect') {
    for (const parentColumn of relation.parentCols) {
      const parentFieldName = toFieldName(contract, parentModelName, parentColumn);
      scalarData[parentFieldName] = null;
    }
    return;
  }

  if (mutation.kind === 'create') {
    const row = mutation.data[0];
    if (!row) {
      throw new Error(
        `create() nested mutation for relation "${relation.relationName}" requires data`,
      );
    }

    const relatedRow = await createGraph(
      scope,
      contract,
      relation.relatedModelName,
      row as MutationCreateInput<SqlContract<SqlStorage>, string>,
    );
    copyRelatedValuesToParent(contract, parentModelName, relation, scalarData, relatedRow);
    return;
  }

  const criterion = mutation.criteria[0];
  if (!criterion) {
    throw new Error(
      `connect() nested mutation for relation "${relation.relationName}" requires criterion`,
    );
  }

  const relatedRow = await findRowByCriterion(
    scope,
    contract,
    relation.relatedModelName,
    criterion as Record<string, unknown>,
  );
  if (!relatedRow) {
    throw new Error(
      `connect() nested mutation for relation "${relation.relationName}" did not find a matching row`,
    );
  }

  copyRelatedValuesToParent(contract, parentModelName, relation, scalarData, relatedRow);
}

function copyRelatedValuesToParent(
  contract: SqlContract<SqlStorage>,
  parentModelName: string,
  relation: RelationDefinition,
  scalarData: Record<string, unknown>,
  relatedRow: Record<string, unknown>,
): void {
  for (let i = 0; i < relation.parentCols.length; i++) {
    const parentColumn = relation.parentCols[i];
    const childColumn = relation.childCols[i];
    if (!parentColumn || !childColumn) {
      continue;
    }

    const parentFieldName = toFieldName(contract, parentModelName, parentColumn);
    const childFieldName = toFieldName(contract, relation.relatedModelName, childColumn);
    scalarData[parentFieldName] = relatedRow[childFieldName];
  }
}

async function applyChildOwnedMutation(
  scope: RuntimeScope,
  contract: SqlContract<SqlStorage>,
  parentModelName: string,
  parentRow: Record<string, unknown>,
  relation: RelationDefinition,
  mutation: RelationMutation<SqlContract<SqlStorage>, string>,
): Promise<void> {
  const parentValues = readParentColumnValues(contract, parentModelName, relation, parentRow);

  if (mutation.kind === 'create') {
    for (const childInput of mutation.data) {
      const payload = {
        ...(childInput as Record<string, unknown>),
      };

      for (const [childColumn, parentValue] of parentValues.entries()) {
        const childFieldName = toFieldName(contract, relation.relatedModelName, childColumn);
        payload[childFieldName] = parentValue;
      }

      await createGraph(
        scope,
        contract,
        relation.relatedModelName,
        payload as MutationCreateInput<SqlContract<SqlStorage>, string>,
      );
    }
    return;
  }

  if (mutation.kind === 'connect') {
    for (const criterion of mutation.criteria) {
      const criterionWhere = shorthandToWhereExpr(
        contract,
        relation.relatedModelName,
        criterion as MutationUpdateInput<SqlContract<SqlStorage>, string>,
      );
      if (!criterionWhere) {
        throw new Error(
          `connect() nested mutation for relation "${relation.relationName}" requires non-empty criterion`,
        );
      }

      const setValues: Record<string, unknown> = {};
      for (const [childColumn, parentValue] of parentValues.entries()) {
        setValues[childColumn] = parentValue;
      }

      await executeUpdateCount(scope, contract, relation.relatedTableName, setValues, [
        criterionWhere,
      ]);
    }
    return;
  }

  const setValues: Record<string, unknown> = {};
  for (const childColumn of parentValues.keys()) {
    setValues[childColumn] = null;
  }

  if (!mutation.criteria || mutation.criteria.length === 0) {
    const parentJoinWhere = buildChildJoinWhere(relation, parentValues);
    await executeUpdateCount(scope, contract, relation.relatedTableName, setValues, [
      parentJoinWhere,
    ]);
    return;
  }

  for (const criterion of mutation.criteria) {
    const criterionWhere = shorthandToWhereExpr(
      contract,
      relation.relatedModelName,
      criterion as MutationUpdateInput<SqlContract<SqlStorage>, string>,
    );
    if (!criterionWhere) {
      throw new Error(
        `disconnect() nested mutation for relation "${relation.relationName}" requires non-empty criterion`,
      );
    }

    const parentJoinWhere = buildChildJoinWhere(relation, parentValues);
    await executeUpdateCount(scope, contract, relation.relatedTableName, setValues, [
      and(parentJoinWhere, criterionWhere),
    ]);
  }
}

function readParentColumnValues(
  contract: SqlContract<SqlStorage>,
  parentModelName: string,
  relation: RelationDefinition,
  parentRow: Record<string, unknown>,
): Map<string, unknown> {
  const values = new Map<string, unknown>();

  for (let i = 0; i < relation.parentCols.length; i++) {
    const parentColumn = relation.parentCols[i];
    const childColumn = relation.childCols[i];
    if (!parentColumn || !childColumn) {
      continue;
    }

    const parentFieldName = toFieldName(contract, parentModelName, parentColumn);
    const parentValue = parentRow[parentFieldName];
    if (parentValue === undefined) {
      throw new Error(
        `Nested mutation requires parent field "${parentFieldName}" to be present in returned row`,
      );
    }

    values.set(childColumn, parentValue);
  }

  return values;
}

function buildChildJoinWhere(
  relation: RelationDefinition,
  childValues: Map<string, unknown>,
): WhereExpr {
  const exprs: WhereExpr[] = [];

  for (const [childColumn, parentValue] of childValues.entries()) {
    exprs.push(
      BinaryExpr.eq(
        ColumnRef.of(relation.relatedTableName, childColumn),
        LiteralExpr.of(parentValue),
      ),
    );
  }

  const first = exprs[0];
  if (exprs.length === 1 && first !== undefined) {
    return first;
  }

  return and(...exprs);
}

async function insertSingleRow(
  scope: RuntimeScope,
  contract: SqlContract<SqlStorage>,
  modelName: string,
  data: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tableName = resolveModelTableName(contract, modelName);
  const mappedData = mapModelDataToStorageRow(contract, modelName, data);
  const compiled = compileInsertReturning(contract, tableName, [mappedData], undefined);
  const rows = await executeQueryPlan<Record<string, unknown>>(scope, compiled).toArray();

  const firstRow = rows[0];
  if (!firstRow) {
    throw new Error(`Nested create for model "${modelName}" did not return a row`);
  }

  return mapStorageRowToModelFields(contract, tableName, firstRow);
}

async function findRowByCriterion(
  scope: RuntimeScope,
  contract: SqlContract<SqlStorage>,
  modelName: string,
  criterion: Record<string, unknown>,
): Promise<Record<string, unknown> | null> {
  const whereExpr = shorthandToWhereExpr(
    contract,
    modelName,
    criterion as MutationUpdateInput<SqlContract<SqlStorage>, string>,
  );
  if (!whereExpr) {
    throw new Error(`Nested connect for model "${modelName}" requires non-empty criterion`);
  }

  const tableName = resolveModelTableName(contract, modelName);
  const state: CollectionState = {
    ...emptyState(),
    filters: [whereExpr],
    limit: 1,
  };
  const compiled = compileSelect(contract, tableName, state);
  const rows = await executeQueryPlan<Record<string, unknown>>(scope, compiled).toArray();

  const firstRow = rows[0];
  if (!firstRow) {
    return null;
  }

  return mapStorageRowToModelFields(contract, tableName, firstRow);
}

async function findFirstByFilters(
  scope: RuntimeScope,
  contract: SqlContract<SqlStorage>,
  modelName: string,
  filters: readonly WhereExpr[],
): Promise<Record<string, unknown> | null> {
  const tableName = resolveModelTableName(contract, modelName);
  const state: CollectionState = {
    ...emptyState(),
    filters,
    limit: 1,
  };
  const compiled = compileSelect(contract, tableName, state);
  const rows = await executeQueryPlan<Record<string, unknown>>(scope, compiled).toArray();

  const firstRow = rows[0];
  if (!firstRow) {
    return null;
  }

  return mapStorageRowToModelFields(contract, tableName, firstRow);
}

async function executeUpdateCount(
  scope: RuntimeScope,
  contract: SqlContract<SqlStorage>,
  tableName: string,
  setValues: Record<string, unknown>,
  filters: readonly WhereExpr[],
): Promise<void> {
  const compiled = compileUpdateCount(contract, tableName, setValues, filters);
  await executeQueryPlan<Record<string, unknown>>(scope, compiled).toArray();
}

function getRelationDefinitions(
  contract: SqlContract<SqlStorage>,
  modelName: string,
): RelationDefinition[] {
  const parentTableName = resolveModelTableName(contract, modelName);
  const tableRelations = contract.relations as Record<string, Record<string, unknown>>;
  const relationMap = tableRelations[parentTableName] ?? {};

  const definitions: RelationDefinition[] = [];
  for (const [relationName, relationValue] of Object.entries(relationMap)) {
    if (!relationValue || typeof relationValue !== 'object') {
      continue;
    }

    const relation = relationValue as {
      to?: unknown;
      cardinality?: unknown;
      on?: {
        parentCols?: unknown;
        childCols?: unknown;
      };
    };

    if (typeof relation.to !== 'string') {
      continue;
    }

    const parentCols = relation.on?.parentCols;
    const childCols = relation.on?.childCols;
    if (!Array.isArray(parentCols) || !Array.isArray(childCols)) {
      continue;
    }

    definitions.push({
      relationName,
      relatedModelName: relation.to,
      relatedTableName: resolveModelTableName(contract, relation.to),
      cardinality: parseCardinality(relation.cardinality),
      parentCols: [...parentCols],
      childCols: [...childCols],
    });
  }

  return definitions;
}

function parseCardinality(value: unknown): RelationCardinalityTag | undefined {
  if (value === '1:1' || value === 'N:1' || value === '1:N' || value === 'M:N') {
    return value;
  }
  return undefined;
}

function toFieldName(
  contract: SqlContract<SqlStorage>,
  modelName: string,
  columnName: string,
): string {
  const tableName = resolveModelTableName(contract, modelName);
  const columnToField = contract.mappings.columnToField?.[tableName] ?? {};
  return columnToField[columnName] ?? columnName;
}
