/**
 * Auto-include walker for `t.prismaField` resolvers.
 *
 * Walks the GraphQL ResolveInfo once and returns:
 * - an `apply` function that applies `.select(...)` and `.include(rel, ...)`
 *   to a base prisma-next Collection
 * - a `reshape` function that lifts `combine` branches onto flat parent
 *   keys and recurses into nested relations
 *
 * Reads field-config extensions set by the field builders:
 * - PRISMA_NEXT_RELATION: `{ relationName, parentModel, targetModel, cardinality, opts }`
 * - PRISMA_NEXT_RELATION_COUNT: `{ relationName, parentModel, opts }`
 *
 * Emission rules per relation group (all GraphQL fields backed by the
 * same prisma-next relation):
 * - 0 fields: nothing.
 * - 1 row field, no count, alias === relationName: plain `.include(rel, ...)`.
 *   Result: `parent[relationName] = T | T[]`. No reshape lift at this level
 *   (recursion may add child reshapes).
 * - Any other shape: `.include(rel, p => p.combine({ alias: branch, ... }))`.
 *   Result: `parent[relationName] = { branchAlias1: ..., branchAlias2: ... }`.
 *   Reshape lifts each branchAlias onto `parent[branchAlias]`.
 */
import type { BuildCache, SchemaTypes } from '@pothos/core';
import type { Contract } from '@prisma-next/contract/types';
import type { SqlStorage } from '@prisma-next/sql-contract/types';
import type { Collection } from '@prisma-next/sql-orm-client';
import {
  type FieldNode,
  type GraphQLObjectType,
  type GraphQLResolveInfo,
  getArgumentValues,
  getNamedType,
  isObjectType,
  Kind,
  type SelectionSetNode,
} from 'graphql';
import { PRISMA_NEXT_RELATION, PRISMA_NEXT_RELATION_COUNT } from './types';

/**
 * Extension key set automatically by Pothos core's `exposeField` (which
 * `t.exposeID/Int/Float/String/Boolean[List]` all funnel through). Carries
 * the column name passed to `exposeX(name, ...)` so the walker can map a
 * GraphQL field selection back to its parent-row column without guessing
 * from the GraphQL field name.
 *
 * Source: `@pothos/core` `fieldUtils/base.ts:107`.
 */
const POTHOS_EXPOSED_FIELD = 'pothosExposedField';

/**
 * Extension key Pothos core uses to stash the original `t.field` /
 * `t.exposeX` options object (`pothosOptions: options as never` in
 * `@pothos/core` `fieldUtils/base.ts:75`). The walker reads `select`
 * off this object — that's the contract-typed `select` augmentation
 * declared in `global-types.ts`.
 */
const POTHOS_FIELD_OPTIONS = 'pothosOptions';

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

export type Reshape = (row: unknown) => unknown;
const noopReshape: Reshape = (row) => row;

interface PreparedQuery {
  collection: AnyCollection;
  reshape: Reshape;
}

/**
 * Public entry: prepare a Collection for the field's selection.
 *
 * `context` is forwarded so any nested `t.relation('rel', { query: (args, ctx) => ... })`
 * callback fires with the request's context. `info.variableValues` is read
 * inside the walker to resolve per-relation `args` from each FieldNode.
 */
export function applySelectionToCollection(
  baseCollection: AnyCollection,
  info: GraphQLResolveInfo,
  buildCache: BuildCache<SchemaTypes>,
  context: unknown,
): PreparedQuery {
  const returnType = getNamedType(info.returnType);
  if (!isObjectType(returnType)) {
    return { collection: baseCollection, reshape: noopReshape };
  }
  const fieldNode = info.fieldNodes[0];
  if (!fieldNode?.selectionSet) {
    return { collection: baseCollection, reshape: noopReshape };
  }

  const walk = walkSelection(returnType, fieldNode.selectionSet, info, buildCache, context);
  return { collection: walk.apply(baseCollection), reshape: walk.reshape };
}

interface WalkResult {
  apply: (collection: AnyCollection) => AnyCollection;
  reshape: Reshape;
}

/**
 * Walk one level of a GraphQL selection set against a Pothos object
 * type. Returns:
 * - `apply`: a function that takes a Collection (for the type) and
 *   chains the necessary `.select(...)` / `.include(rel, ...)` calls.
 * - `reshape`: a function that lifts combine branches and recurses.
 */
function walkSelection(
  type: GraphQLObjectType,
  selectionSet: SelectionSetNode,
  info: GraphQLResolveInfo,
  buildCache: BuildCache<SchemaTypes>,
  context: unknown,
): WalkResult {
  const { scalarFields, relationGroups } = collectFields(type, selectionSet);

  // Workaround for the orm-client's nested-stitch FK gap (workarounds.md W-1).
  const parentModelName = collectParentModelName(type);
  const fkColumns = parentModelName
    ? collectLocalFkColumnsByGroup(buildCache, parentModelName, relationGroups)
    : new Set<string>();
  const allSelectFields = new Set<string>([...scalarFields, ...fkColumns]);

  // Per-group emission plans (computed eagerly).
  const groupPlans: GroupPlan[] = [];

  for (const [relationName, group] of relationGroups) {
    const rowAliases = new Map<string, { walk: WalkResult; cardinality: string }>();
    const allAliases: string[] = [];

    for (const [alias, entry] of group.rowFields) {
      const relReturnType = getRelationReturnType(type, entry.fieldNode.name.value);
      const innerWalk =
        relReturnType && entry.fieldNode.selectionSet
          ? walkSelection(relReturnType, entry.fieldNode.selectionSet, info, buildCache, context)
          : { apply: (c: AnyCollection) => c, reshape: noopReshape };
      // Wrap apply with the refine. Both the static (object) and dynamic
      // (callback) forms of `query` are supported. The dynamic form
      // receives the field's resolved args (via getArgumentValues against
      // the parent type's field def) and the request context.
      const opts = entry.ext.opts;
      const innerWithRefine: WalkResult = {
        apply: (c) => {
          let r = c;
          if (opts.query !== undefined) {
            const refine =
              typeof opts.query === 'function'
                ? (() => {
                    const fieldDef = type.getFields()[entry.fieldNode.name.value];
                    const args = fieldDef
                      ? getArgumentValues(fieldDef, entry.fieldNode, info.variableValues)
                      : {};
                    return opts.query(args, context);
                  })()
                : opts.query;
            if (refine && typeof refine === 'object') {
              r = applyStaticRefine(r, refine as RelationRefine);
            }
          }
          return innerWalk.apply(r);
        },
        reshape: innerWalk.reshape,
      };
      rowAliases.set(alias, { walk: innerWithRefine, cardinality: entry.ext.cardinality });
      allAliases.push(alias);
    }
    const countAliases = new Set<string>();
    for (const alias of group.countFields.keys()) {
      countAliases.add(alias);
      allAliases.push(alias);
    }

    const totalBranches = rowAliases.size + countAliases.size;
    const plainEligible = totalBranches === 1 && countAliases.size === 0;
    const firstRowEntry = rowAliases.entries().next().value;
    const plainAlias = plainEligible && firstRowEntry ? firstRowEntry[0] : undefined;
    const plainCardinality =
      plainEligible && firstRowEntry ? firstRowEntry[1].cardinality : undefined;

    groupPlans.push({
      relationName,
      isCombine: !plainEligible,
      rowAliases,
      countAliases,
      allAliases,
      plainAlias,
      plainCardinality,
    });
  }

  // Build the apply function (called at runtime with a real Collection).
  const apply = (collection: AnyCollection): AnyCollection => {
    let acc = collection;

    if (allSelectFields.size > 0) {
      const sel = (acc as unknown as { select: (...names: string[]) => AnyCollection }).select;
      if (typeof sel === 'function') {
        acc = sel.apply(acc, [...allSelectFields]);
      }
    }

    for (const plan of groupPlans) {
      if (!plan.isCombine) {
        if (plan.plainAlias === undefined) continue;
        const entry = plan.rowAliases.get(plan.plainAlias);
        if (!entry) continue;
        const { walk } = entry;
        acc = (
          acc as unknown as {
            include: (n: string, refine?: (rel: AnyCollection) => AnyCollection) => AnyCollection;
          }
        ).include(plan.relationName, (rel) => walk.apply(rel));
        continue;
      }

      // Combine: emit one .include(rel, p => p.combine({...})).
      acc = (
        acc as unknown as {
          include: (n: string, refine?: (rel: AnyCollection) => AnyCollection) => AnyCollection;
        }
      ).include(plan.relationName, (rel) => {
        const spec: Record<string, unknown> = {};
        for (const [alias, { walk }] of plan.rowAliases) {
          spec[alias] = walk.apply(rel);
        }
        for (const alias of plan.countAliases) {
          spec[alias] = (rel as unknown as { count: () => unknown }).count();
        }
        return (
          rel as unknown as { combine: (s: Record<string, unknown>) => AnyCollection }
        ).combine(spec);
      });
    }

    return acc;
  };

  // Build the reshape function (called per-row at result-time).
  const reshape = buildReshape(groupPlans);

  return { apply, reshape };
}

interface RelationFieldEntry {
  fieldNode: FieldNode;
  ext: RelationFieldExt;
}

interface RelationCountFieldEntry {
  fieldNode: FieldNode;
  ext: RelationCountFieldExt;
}

interface RelationGroup {
  rowFields: Map<string, RelationFieldEntry>;
  countFields: Map<string, RelationCountFieldEntry>;
}

interface CollectedFields {
  scalarFields: Set<string>;
  relationGroups: Map<string, RelationGroup>;
}

function collectFields(type: GraphQLObjectType, selectionSet: SelectionSetNode): CollectedFields {
  const scalarFields = new Set<string>();
  const relationGroups = new Map<string, RelationGroup>();
  const typeFields = type.getFields();

  function getOrCreateGroup(relationName: string): RelationGroup {
    let g = relationGroups.get(relationName);
    if (!g) {
      g = { rowFields: new Map(), countFields: new Map() };
      relationGroups.set(relationName, g);
    }
    return g;
  }

  for (const sel of selectionSet.selections) {
    if (sel.kind !== Kind.FIELD) continue;
    if (sel.name.value.startsWith('__')) continue;

    const fieldDef = typeFields[sel.name.value];
    if (!fieldDef) continue;

    const ext = (fieldDef.extensions ?? {}) as Record<string | symbol, unknown>;
    const alias = sel.alias?.value ?? sel.name.value;

    const relationExt = ext[PRISMA_NEXT_RELATION] as RelationFieldExt | undefined;
    if (relationExt) {
      getOrCreateGroup(relationExt.relationName).rowFields.set(alias, {
        fieldNode: sel,
        ext: relationExt,
      });
      continue;
    }

    const countExt = ext[PRISMA_NEXT_RELATION_COUNT] as RelationCountFieldExt | undefined;
    if (countExt) {
      getOrCreateGroup(countExt.relationName).countFields.set(alias, {
        fieldNode: sel,
        ext: countExt,
      });
      continue;
    }

    // Column dependency lookup. Two sources, in order:
    //
    // 1. `pothosExposedField` — set automatically by Pothos core for every
    //    `t.exposeID/Int/Float/String/Boolean[List]` field, carrying the
    //    column name the user passed (which is type-checked against the
    //    parent row shape via Pothos's `CompatibleTypes` constraint).
    //
    // 2. `t.field({ select: { col1: true, col2: true } })` — the typed
    //    `select` option (declared on `ObjectFieldOptions` in
    //    global-types.ts). For computed resolvers that depend on one or
    //    more columns from the parent row (`fullName = firstName + ' ' +
    //    lastName`). Pothos preserves the original options at
    //    `pothosOptions`; the walker reads `select` off that.
    //
    // A `t.field` with neither contributes no SELECT — its resolver runs
    // against whatever else the row already carries. Same model
    // plugin-prisma uses (`pothosPrismaSelect`).
    const exposed = ext[POTHOS_EXPOSED_FIELD];
    if (typeof exposed === 'string') {
      scalarFields.add(exposed);
    }
    const opts = ext[POTHOS_FIELD_OPTIONS] as { select?: Record<string, unknown> } | undefined;
    if (opts?.select && typeof opts.select === 'object') {
      for (const col of Object.keys(opts.select)) {
        if (opts.select[col] === true) scalarFields.add(col);
      }
    }
  }

  return { scalarFields, relationGroups };
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

function isToManyCardinality(c: string): boolean {
  return c === '1:N' || c === 'M:N';
}

function collectParentModelName(type: GraphQLObjectType): string | undefined {
  const ext = (type.extensions ?? {}) as Record<string, unknown>;
  return ext['pothosPrismaNextModel'] as string | undefined;
}

function collectLocalFkColumnsByGroup(
  buildCache: BuildCache<SchemaTypes>,
  parentModelName: string,
  relationGroups: Map<string, RelationGroup>,
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
  for (const relationName of relationGroups.keys()) {
    const rel = parentModel.relations[relationName];
    if (!rel?.on?.localFields) continue;
    for (const f of rel.on.localFields) out.add(f);
  }
  return out;
}

interface RelationRefine {
  where?: unknown;
  orderBy?: unknown;
  take?: number;
  skip?: number;
}

function applyStaticRefine(collection: AnyCollection, refine: RelationRefine): AnyCollection {
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

// ---------------------------------------------------------------------------
// Reshape construction
// ---------------------------------------------------------------------------

interface GroupPlan {
  relationName: string;
  isCombine: boolean;
  rowAliases: Map<string, { walk: WalkResult; cardinality: string }>;
  countAliases: Set<string>;
  allAliases: string[];
  plainAlias: string | undefined;
  plainCardinality: string | undefined;
}

function buildReshape(groupPlans: GroupPlan[]): Reshape {
  // Per-relation reshape ops: applied to `parent[relationName]`.
  const relationOps: Array<{
    relationName: string;
    op: (value: unknown, parentRow: Record<string, unknown>) => void;
  }> = [];

  for (const plan of groupPlans) {
    if (!plan.isCombine) {
      if (plan.plainAlias === undefined || plan.plainCardinality === undefined) continue;
      const plainAlias = plan.plainAlias;
      const inner = plan.rowAliases.get(plainAlias)?.walk.reshape ?? noopReshape;
      const isList = isToManyCardinality(plan.plainCardinality);
      const childReshape = makeListOrObjectReshape(inner, isList);
      const aliasDiffers = plainAlias !== plan.relationName;

      relationOps.push({
        relationName: plan.relationName,
        op: (value, parentRow) => {
          const reshaped = childReshape(value);
          if (aliasDiffers) {
            parentRow[plainAlias] = reshaped;
            // Optional: also delete parent[relationName] since the
            // resolver will read parent[plainAlias]. Keep both for now.
          } else {
            parentRow[plan.relationName] = reshaped;
          }
        },
      });
      continue;
    }

    // Combine path: parent[relationName] = { alias1: ..., alias2: ... }.
    // Reshape each branch and lift onto the parent row.
    const branchReshapes = new Map<string, Reshape>();
    for (const [alias, { walk, cardinality }] of plan.rowAliases) {
      branchReshapes.set(
        alias,
        makeListOrObjectReshape(walk.reshape, isToManyCardinality(cardinality)),
      );
    }

    relationOps.push({
      relationName: plan.relationName,
      op: (value, parentRow) => {
        if (value == null || typeof value !== 'object' || Array.isArray(value)) {
          // Unexpected shape — leave alone.
          return;
        }
        const branches = value as Record<string, unknown>;
        // Reshape row branches recursively.
        for (const [alias, reshape] of branchReshapes) {
          if (alias in branches) {
            branches[alias] = reshape(branches[alias]);
          }
        }
        // Lift every alias onto the parent.
        for (const alias of plan.allAliases) {
          if (alias in branches) {
            parentRow[alias] = branches[alias];
          }
        }
        // Keep parent[relationName] for backwards-compatible reads, but
        // the resolver checks parent[fieldName] first so it doesn't matter.
      },
    });
  }

  if (relationOps.length === 0) return noopReshape;

  return (row) => {
    if (row == null || typeof row !== 'object') return row;
    const r = row as Record<string, unknown>;
    for (const { relationName, op } of relationOps) {
      if (relationName in r) {
        op(r[relationName], r);
      }
    }
    return r;
  };
}

function makeListOrObjectReshape(reshape: Reshape, isList: boolean): Reshape {
  if (reshape === noopReshape) return noopReshape;
  if (isList) {
    return (val) => {
      if (val == null) return val;
      if (Array.isArray(val)) return val.map(reshape);
      return reshape(val);
    };
  }
  return (val) => (val == null ? val : reshape(val));
}
