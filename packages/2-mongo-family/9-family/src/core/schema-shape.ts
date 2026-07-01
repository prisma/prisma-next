/**
 * Mongo-family schema-shape callbacks for the aggregate planner/verifier.
 *
 * The framework is unaware of any storage shape (ADR: framework layer purity);
 * it hands the Mongo family its own introspected schema and asks two questions:
 * "prune this to a member's slice" and "list its entity names". Mongo's
 * introspected `MongoSchemaIR` exposes `collections` as an array of
 * `{ name, ... }`; the callbacks walk that array.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Prunes collections owned by other members from a Mongo introspected schema.
 * Returns a plain object (`{ ...schema, collections: prunedArray }`); the caller
 * rewraps it into a `MongoSchemaIR` when the class accessors are needed. Returns
 * the input unchanged when it is not an object or nothing was removed.
 */
export function mongoProjectSchemaToMember(
  schema: unknown,
  ownedByOtherNames: ReadonlySet<string>,
): unknown {
  if (!isRecord(schema)) return schema;

  if (Array.isArray(schema['collections'])) {
    return pruneCollectionsArray(schema, ownedByOtherNames);
  }

  if (isRecord(schema['collections'])) {
    return pruneCollectionsRecord(schema, ownedByOtherNames);
  }

  return schema;
}

/**
 * Bare names of every live collection in a Mongo introspected schema.
 */
export function mongoListSchemaEntityNames(schema: unknown): readonly string[] {
  if (!isRecord(schema)) return [];
  const collections = schema['collections'];
  if (Array.isArray(collections)) {
    const names: string[] = [];
    for (const entry of collections) {
      if (isRecord(entry) && typeof entry['name'] === 'string') {
        names.push(entry['name']);
      }
    }
    return names;
  }
  if (isRecord(collections)) {
    return Object.keys(collections);
  }
  return [];
}

function pruneCollectionsArray(
  schema: Record<string, unknown>,
  ownedByOthers: ReadonlySet<string>,
): unknown {
  const source = schema['collections'] as ReadonlyArray<unknown>;
  let removed = false;
  const pruned: unknown[] = [];
  for (const entry of source) {
    if (isRecord(entry)) {
      const name = entry['name'];
      if (typeof name === 'string' && ownedByOthers.has(name)) {
        removed = true;
        continue;
      }
    }
    pruned.push(entry);
  }
  if (!removed) return schema;
  return { ...schema, collections: pruned };
}

function pruneCollectionsRecord(
  schema: Record<string, unknown>,
  ownedByOthers: ReadonlySet<string>,
): unknown {
  const source = schema['collections'] as Record<string, unknown>;
  let removed = false;
  const pruned: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(source)) {
    if (ownedByOthers.has(name)) {
      removed = true;
    } else {
      pruned[name] = value;
    }
  }
  if (!removed) return schema;
  return { ...schema, collections: pruned };
}
