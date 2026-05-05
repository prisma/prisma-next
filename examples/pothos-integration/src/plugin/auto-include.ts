/**
 * Auto-include walker for `t.prismaField` resolvers.
 *
 * Given a `GraphQLResolveInfo` and a base prisma-next `Collection`, walk
 * the GraphQL selection set, recursively chain `.select(...)` and
 * `.include(rel, refineFn)` onto the collection, and return the prepared
 * collection.
 *
 * The walker reads field-config extensions set by the field builders:
 * - PRISMA_NEXT_RELATION: `{ relationName, parentModel, targetModel, cardinality, opts }`
 * - PRISMA_NEXT_RELATION_COUNT: `{ relationName, parentModel, opts }`
 *
 * For M1 we handle:
 * - scalar exposeX: add the column to `.select(...)`
 * - single-field-per-relation: emit a plain `.include(rel, refineFn)`
 *
 * For M2 we extend this with sibling-grouping into `.combine({...})`
 * and a per-row reshape that lifts combine branches up to peer keys.
 */
import type { BuildCache, SchemaTypes } from '@pothos/core';
import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { Collection } from '@prisma-next/sql-orm-client';
import {
  type FieldNode,
  type GraphQLObjectType,
  type GraphQLResolveInfo,
  getNamedType,
  isObjectType,
  Kind,
  type SelectionSetNode,
} from 'graphql';
import { PRISMA_NEXT_RELATION, PRISMA_NEXT_RELATION_COUNT } from './types';

interface RelationFieldExt {
  relationName: string;
  parentModel: string;
  targetModel: string;
  cardinality: '1:1' | '1:N' | 'N:1' | 'M:N' | string;
  opts: {
    description?: string;
    nullable?: boolean;
    args?: unknown;
    query?:
      | { where?: unknown; orderBy?: unknown; take?: number; skip?: number }
      | ((args: unknown, ctx: unknown) => unknown);
  };
}

interface RelationCountFieldExt {
  relationName: string;
  parentModel: string;
  opts: {
    description?: string;
    args?: unknown;
    where?: unknown | ((args: unknown, ctx: unknown) => unknown);
  };
}

type AnyCollection = Collection<Contract<SqlStorage>, string, unknown, never>;

/**
 * Public entry: prepare a Collection for the field's selection.
 */
export function applySelectionToCollection(
  baseCollection: AnyCollection,
  info: GraphQLResolveInfo,
  buildCache: BuildCache<SchemaTypes>,
): AnyCollection {
  const returnType = getNamedType(info.returnType);
  if (!isObjectType(returnType)) {
    return baseCollection;
  }

  const fieldNode = info.fieldNodes[0];
  if (!fieldNode?.selectionSet) {
    return baseCollection;
  }

  return applyToCollection(baseCollection, returnType, fieldNode.selectionSet, info, buildCache);
}

function applyToCollection(
  collection: AnyCollection,
  type: GraphQLObjectType,
  selectionSet: SelectionSetNode,
  info: GraphQLResolveInfo,
  buildCache: BuildCache<SchemaTypes>,
): AnyCollection {
  const { scalarFields, relationFields, relationCountFields } = collectFields(
    type,
    selectionSet,
    info,
  );

  let acc = collection;

  // 0. The orm-client only auto-augments a parent fetch with the immediate
  //    targetColumn of an include. When THIS fetch is itself a child fetch
  //    inside a nested-stitch chain, the orm-client doesn't know to also
  //    select the localColumns the child needs for its own outgoing
  //    includes. We compensate by explicitly adding those columns to the
  //    parent's select so nested-stitch can match. (See
  //    `resolveRowsByParent` / `augmentSelectionForJoinColumns` in
  //    `collection-dispatch.ts:368-417`.)
  const parentModelName = collectParentModelName(type);
  const fkColumns = parentModelName
    ? collectLocalFkColumns(buildCache, parentModelName, relationFields)
    : new Set<string>();

  // 1. Apply scalar selection. Prisma-next's `.select(...)` accepts string
  //    column names. We always include the GraphQL field name; we trust the
  //    contract that the field name === the model field name (the demo
  //    schema satisfies this; for general use we'd consult contract.models[
  //    parentModel].storage.fields[X].column to translate).
  const allFields = new Set<string>([...scalarFields, ...fkColumns]);
  if (allFields.size > 0) {
    const sel = (acc as unknown as { select: (...names: string[]) => AnyCollection }).select;
    if (typeof sel === 'function') {
      acc = sel.apply(acc, [...allFields]);
    }
  }

  // 2. Apply each relation as a plain include. M2 expands this to combine
  //    when multiple GraphQL fields back the same relation.
  for (const [graphqlFieldName, relInfo] of relationFields) {
    acc = (
      acc as unknown as {
        include: (relName: string, refine?: (rel: AnyCollection) => AnyCollection) => AnyCollection;
      }
    ).include(relInfo.ext.relationName, (relCollection: AnyCollection) => {
      let prepared = relCollection;

      // Apply field-time `query: { where, orderBy, take, skip }` if static.
      if (relInfo.ext.opts.query && typeof relInfo.ext.opts.query !== 'function') {
        prepared = applyStaticRefine(prepared, relInfo.ext.opts.query);
      }

      // Recurse into the relation's subselection.
      const relReturnType = getRelationReturnType(type, graphqlFieldName);
      if (relReturnType && relInfo.fieldNode.selectionSet) {
        prepared = applyToCollection(
          prepared,
          relReturnType,
          relInfo.fieldNode.selectionSet,
          info,
          buildCache,
        );
      }
      return prepared;
    });
  }

  // 3. Relation-count fields: M1 leaves these unhandled (they only kick in
  //    in M2 once we have combine emission). The resolver throws a clear
  //    error if a relation-count field is queried in M1.
  if (relationCountFields.size > 0) {
    // Surface a console warning so the demo author sees this isn't wired
    // until M2.
    // eslint-disable-next-line no-console
    console.warn(
      '[pothos-prisma-next] relationCount fields encountered in M1 walker; not yet wired to combine. ' +
        `Fields: ${[...relationCountFields.keys()].join(', ')}`,
    );
  }

  return acc;
}

interface CollectedFields {
  scalarFields: Set<string>;
  relationFields: Map<string, { fieldNode: FieldNode; ext: RelationFieldExt }>;
  relationCountFields: Map<string, { fieldNode: FieldNode; ext: RelationCountFieldExt }>;
}

function collectFields(
  type: GraphQLObjectType,
  selectionSet: SelectionSetNode,
  _info: GraphQLResolveInfo,
): CollectedFields {
  const scalarFields = new Set<string>();
  const relationFields = new Map<string, { fieldNode: FieldNode; ext: RelationFieldExt }>();
  const relationCountFields = new Map<
    string,
    { fieldNode: FieldNode; ext: RelationCountFieldExt }
  >();
  const typeFields = type.getFields();

  for (const sel of selectionSet.selections) {
    if (sel.kind !== Kind.FIELD) {
      // M1 doesn't handle fragments; the demo schema doesn't use them.
      continue;
    }
    if (sel.name.value.startsWith('__')) {
      continue;
    }

    const fieldDef = typeFields[sel.name.value];
    if (!fieldDef) continue;

    const ext = (fieldDef.extensions ?? {}) as Record<string | symbol, unknown>;

    const relationExt = ext[PRISMA_NEXT_RELATION] as RelationFieldExt | undefined;
    if (relationExt) {
      const alias = sel.alias?.value ?? sel.name.value;
      relationFields.set(alias, { fieldNode: sel, ext: relationExt });
      continue;
    }

    const countExt = ext[PRISMA_NEXT_RELATION_COUNT] as RelationCountFieldExt | undefined;
    if (countExt) {
      const alias = sel.alias?.value ?? sel.name.value;
      relationCountFields.set(alias, { fieldNode: sel, ext: countExt });
      continue;
    }

    // Otherwise treat as a scalar (exposeX-style or simple field).
    // For exposeX fields, the field name === the model column name.
    scalarFields.add(sel.name.value);
  }

  return { scalarFields, relationFields, relationCountFields };
}

function getRelationReturnType(
  parentType: GraphQLObjectType,
  fieldName: string,
): GraphQLObjectType | undefined {
  const field = parentType.getFields()[fieldName];
  if (!field) return undefined;
  const named = getNamedType(field.type);
  return isObjectType(named) ? named : undefined;
}

/**
 * Find the prisma-next model name attached to this GraphQL type.
 * `prismaObject` stamps `extensions[PRISMA_NEXT_MODEL]`; types not
 * created via `prismaObject` will lack it.
 */
function collectParentModelName(type: GraphQLObjectType): string | undefined {
  const ext = (type.extensions ?? {}) as Record<string, unknown>;
  return ext['pothosPrismaNextModel'] as string | undefined;
}

/**
 * Augment the parent's selectedFields with the localFields needed to
 * satisfy each include's stitching join. Workaround for the orm-client's
 * nested-stitch FK gap (see comment at the call site).
 */
function collectLocalFkColumns(
  buildCache: BuildCache<SchemaTypes>,
  parentModelName: string,
  relationFields: Map<string, { ext: RelationFieldExt }>,
): Set<string> {
  const builder = (
    buildCache as unknown as {
      builder: { options: { prismaNext: { contract: Contract<SqlStorage> } } };
    }
  ).builder;
  const contract = builder.options.prismaNext.contract;
  const models = (contract as unknown as { models: Record<string, unknown> }).models;
  const parentModel = models[parentModelName] as
    | { relations?: Record<string, { on?: { localFields?: readonly string[] } }> }
    | undefined;
  if (!parentModel?.relations) return new Set();

  const out = new Set<string>();
  for (const { ext } of relationFields.values()) {
    const rel = parentModel.relations[ext.relationName];
    if (!rel?.on?.localFields) continue;
    for (const f of rel.on.localFields) out.add(f);
  }
  return out;
}

function applyStaticRefine(
  collection: AnyCollection,
  refine: { where?: unknown; orderBy?: unknown; take?: number; skip?: number },
): AnyCollection {
  let acc = collection;
  if (refine.where !== undefined) {
    acc = (acc as unknown as { where: (w: unknown) => AnyCollection }).where(refine.where);
  }
  if (refine.orderBy !== undefined) {
    acc = (acc as unknown as { orderBy: (o: unknown) => AnyCollection }).orderBy(
      refine.orderBy as never,
    );
  }
  if (refine.take !== undefined) {
    acc = (acc as unknown as { take: (n: number) => AnyCollection }).take(refine.take);
  }
  if (refine.skip !== undefined) {
    acc = (acc as unknown as { skip: (n: number) => AnyCollection }).skip(refine.skip);
  }
  return acc;
}
