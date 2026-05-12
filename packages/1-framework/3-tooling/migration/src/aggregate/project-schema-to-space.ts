import type { ContractSpaceMember } from './types';

/**
 * Project the introspected live schema to the slice claimed by a single
 * contract-space member.
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
 *   is checking. Closes the F23 architectural concern (multi-member
 *   deployments where each member's elements look like extras to every
 *   other member's verify pass).
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
 */
export function projectSchemaToSpace(
  schema: unknown,
  member: ContractSpaceMember,
  otherMembers: ReadonlyArray<ContractSpaceMember>,
): unknown {
  if (typeof schema !== 'object' || schema === null) return schema;

  const ownedByOthers = collectOwnedNames(member, otherMembers);
  if (ownedByOthers.size === 0) return schema;

  const schemaObj = schema as { readonly tables?: unknown; readonly collections?: unknown };

  if (typeof schemaObj.tables === 'object' && schemaObj.tables !== null) {
    return pruneRecord(schemaObj, 'tables', ownedByOthers);
  }

  if (Array.isArray(schemaObj.collections)) {
    return pruneCollectionsArray(schemaObj, ownedByOthers);
  }

  if (typeof schemaObj.collections === 'object' && schemaObj.collections !== null) {
    return pruneRecord(schemaObj, 'collections', ownedByOthers);
  }

  return schema;
}

/**
 * Collect element names claimed by other-members. Reads each
 * other-member's `contract.storage` and extracts table/collection names
 * from whichever record-shaped field is present.
 */
function collectOwnedNames(
  member: ContractSpaceMember,
  otherMembers: ReadonlyArray<ContractSpaceMember>,
): Set<string> {
  const owned = new Set<string>();
  for (const other of otherMembers) {
    if (other.spaceId === member.spaceId) continue;
    const storage = (other.contract as { readonly storage?: unknown }).storage;
    if (typeof storage !== 'object' || storage === null) continue;
    const storageObj = storage as { readonly tables?: unknown; readonly collections?: unknown };

    if (typeof storageObj.tables === 'object' && storageObj.tables !== null) {
      for (const name of Object.keys(storageObj.tables as Record<string, unknown>)) {
        owned.add(name);
      }
    }
    if (typeof storageObj.collections === 'object' && storageObj.collections !== null) {
      for (const name of Object.keys(storageObj.collections as Record<string, unknown>)) {
        owned.add(name);
      }
    }
  }
  return owned;
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
