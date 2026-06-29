import { elementCoordinates } from '@prisma-next/framework-components/ir';
import type { ContractSpaceMember } from './types';

/**
 * Project the **introspected live schema** to the slice claimed by a
 * single contract-space member.
 *
 * "Schema" here means the live introspected database state — the
 * planner / verifier sees this object as a `MongoSchemaIR` (Mongo) or
 * `SqlSchemaIR` (SQL). It is **not** a database schema in the SQL
 * `CREATE SCHEMA` sense, nor a contract-space namespace. The
 * function's job is to filter that introspected state down to the
 * elements claimed by one space, so a per-space verify pass doesn't
 * see another space's storage as "extras".
 *
 * Returns the same `schema` value with every top-level storage element
 * (table or collection) claimed by **other** members of the aggregate
 * removed. Elements not claimed by any member flow through unchanged —
 * the planner / verifier sees them as orphans (extras in strict mode).
 *
 * Used by:
 *
 * - The aggregate planner's **synth strategy**: when synthesising a
 *   plan against a member's contract, the live schema must be projected
 *   to that member's slice so the planner doesn't treat elements claimed
 *   by other members as "extras" and emit destructive ops to drop them.
 * - The aggregate verifier's **schemaCheck**: projects per member so the
 *   single-contract verify only sees the slice claimed by the member it
 *   is checking. Closes the architectural concern that a multi-member
 *   deployment makes each member's elements look like extras to every
 *   other member's verify pass.
 *
 * **Duck-typing semantics**: the helper operates on `unknown` for the
 * schema and falls through structurally if the shape doesn't match.
 * Two storage shapes are recognised today:
 *
 * - SQL families expose `storage.tables: Record<string, ...>` on
 *   contracts and the introspected schema mirrors the same record shape.
 *   Pruning iterates the record entries.
 * - Mongo exposes `storage.collections: Record<string, ...>` on
 *   contracts; the introspected `MongoSchemaIR` exposes
 *   `collections: ReadonlyArray<{name: string, ...}>`. Pruning iterates
 *   the array on the schema side and the record's keys on the
 *   other-member side.
 *
 * Schemas of unrecognised shape are returned unchanged. The function
 * never imports family classes (`SqlSchemaIR`, `MongoSchemaIR`); the
 * projected schema is a plain object — `{...schema, tables: pruned}` or
 * `{...schema, collections: pruned}` — that downstream consumers
 * duck-type. A future family with a different storage shape gets the
 * schema returned unchanged rather than blowing up the aggregate
 * planner.
 *
 * Record-shape detection guards against arrays (`!Array.isArray`) so
 * an unrecognised array-shaped value falls through unchanged rather
 * than being pruned by numeric keys.
 */
export function projectSchemaToSpace(
  schema: unknown,
  member: ContractSpaceMember,
  otherMembers: ReadonlyArray<ContractSpaceMember>,
): unknown {
  if (typeof schema !== 'object' || schema === null) return schema;

  const ownedByOthers = collectOwnedNames(member, otherMembers);
  if (ownedByOthers.size === 0) return schema;

  const schemaObj = schema as {
    readonly tables?: unknown;
    readonly collections?: unknown;
    readonly namespaces?: unknown;
  };

  // A namespaced schema tree (the Postgres `PostgresDatabaseSchemaNode` root)
  // groups tables under per-schema namespace nodes rather than a flat `tables`
  // record. Prune each namespace's tables in place, so per-space isolation
  // holds without flattening namespaces into one (collision-prone) record.
  if (
    typeof schemaObj.namespaces === 'object' &&
    schemaObj.namespaces !== null &&
    !Array.isArray(schemaObj.namespaces)
  ) {
    return pruneNamespaceTables(schemaObj, ownedByOthers);
  }

  if (
    typeof schemaObj.tables === 'object' &&
    schemaObj.tables !== null &&
    !Array.isArray(schemaObj.tables)
  ) {
    return pruneRecord(schemaObj, 'tables', ownedByOthers);
  }

  if (Array.isArray(schemaObj.collections)) {
    return pruneCollectionsArray(schemaObj, ownedByOthers);
  }

  if (
    typeof schemaObj.collections === 'object' &&
    schemaObj.collections !== null &&
    !Array.isArray(schemaObj.collections)
  ) {
    return pruneRecord(schemaObj, 'collections', ownedByOthers);
  }

  return schema;
}

function collectOwnedNames(
  member: ContractSpaceMember,
  otherMembers: ReadonlyArray<ContractSpaceMember>,
): Set<string> {
  const owned = new Set<string>();
  for (const other of otherMembers) {
    if (other.spaceId === member.spaceId) continue;
    for (const { entityName } of elementCoordinates(other.contract().storage)) {
      owned.add(entityName);
    }
  }
  return owned;
}

/**
 * Prunes other-space tables from every namespace node of a schema tree root,
 * returning a new root with pruned namespaces. The namespace nodes are spread
 * into plain objects (losing their class prototype), mirroring the flat
 * `pruneRecord` path — downstream consumers duck-type the result, and the
 * `…SchemaNode.ensure()` guards reconstruct a node from the spread shape when
 * a structure-aware consumer needs one.
 */
function pruneNamespaceTables(
  schemaObj: { readonly namespaces?: unknown },
  ownedByOthers: ReadonlySet<string>,
): unknown {
  if (!isRecord(schemaObj.namespaces)) return schemaObj;
  let removed = false;
  const prunedNamespaces: Record<string, unknown> = {};
  for (const [namespaceId, namespaceNode] of Object.entries(schemaObj.namespaces)) {
    if (isRecord(namespaceNode) && isRecord(namespaceNode['tables'])) {
      const prunedNode = pruneRecord(namespaceNode, 'tables', ownedByOthers);
      if (prunedNode !== namespaceNode) removed = true;
      prunedNamespaces[namespaceId] = prunedNode;
    } else {
      prunedNamespaces[namespaceId] = namespaceNode;
    }
  }
  if (!removed) return schemaObj;
  return { ...schemaObj, namespaces: prunedNamespaces };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pruneRecord(
  schemaObj: { readonly tables?: unknown; readonly collections?: unknown },
  field: 'tables' | 'collections',
  ownedByOthers: ReadonlySet<string>,
): unknown {
  const source = schemaObj[field] as Record<string, unknown>;
  let removed = false;
  const pruned: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(source)) {
    if (ownedByOthers.has(name)) {
      removed = true;
    } else {
      pruned[name] = value;
    }
  }
  if (!removed) return schemaObj;
  return { ...schemaObj, [field]: pruned };
}

function pruneCollectionsArray(
  schemaObj: { readonly collections?: unknown },
  ownedByOthers: ReadonlySet<string>,
): unknown {
  const source = schemaObj.collections as ReadonlyArray<unknown>;
  let removed = false;
  const pruned: unknown[] = [];
  for (const entry of source) {
    if (typeof entry === 'object' && entry !== null) {
      const name = (entry as { readonly name?: unknown }).name;
      if (typeof name === 'string' && ownedByOthers.has(name)) {
        removed = true;
        continue;
      }
    }
    pruned.push(entry);
  }
  if (!removed) return schemaObj;
  return { ...schemaObj, collections: pruned };
}
