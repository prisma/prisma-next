/**
 * SQL-family schema-shape callbacks for the aggregate planner/verifier.
 *
 * The framework is unaware of any storage shape (ADR: framework layer purity);
 * it hands the SQL family its own introspected `SqlSchemaIRNode` and asks two
 * questions: "prune this to a member's slice" and "list its entity names". Only
 * the family knows whether the schema is a flat `tables` record (SQLite) or a
 * namespaced tree (Postgres `PostgresDatabaseSchemaNode`), so it answers both.
 */

import { blindCast } from '@prisma-next/utils/casts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Prunes tables owned by other members from a SQL introspected schema. A
 * namespaced tree (Postgres) prunes inside each namespace's `tables`; a flat
 * schema (SQLite) prunes its top-level `tables`. The result is a plain object
 * (`{ ...schema, tables|namespaces: pruned }`); structure-aware consumers
 * `ensure` a typed node from it. Returns the input unchanged when it is not an
 * object or nothing was removed.
 */
export function sqlProjectSchemaToMember(
  schema: unknown,
  ownedByOtherNames: ReadonlySet<string>,
): unknown {
  if (!isRecord(schema)) return schema;

  if (isRecord(schema['namespaces'])) {
    return pruneNamespaceTables(schema, ownedByOtherNames);
  }

  if (isRecord(schema['tables'])) {
    return pruneRecord(schema, 'tables', ownedByOtherNames);
  }

  return schema;
}

/**
 * Bare names of every live table in a SQL introspected schema: gathered across
 * namespaces for a namespaced tree, or the top-level `tables` keys for a flat
 * schema. Any other shape yields none.
 */
export function sqlListSchemaEntityNames(schema: unknown): readonly string[] {
  if (!isRecord(schema)) return [];
  if (isRecord(schema['namespaces'])) {
    const names: string[] = [];
    for (const namespaceNode of Object.values(schema['namespaces'])) {
      if (isRecord(namespaceNode) && isRecord(namespaceNode['tables'])) {
        names.push(...Object.keys(namespaceNode['tables']));
      }
    }
    return names;
  }
  if (isRecord(schema['tables'])) {
    return Object.keys(schema['tables']);
  }
  return [];
}

function pruneNamespaceTables(
  schema: Record<string, unknown>,
  ownedByOthers: ReadonlySet<string>,
): unknown {
  const namespaces = schema['namespaces'];
  if (!isRecord(namespaces)) return schema;
  let removed = false;
  const prunedNamespaces: Record<string, unknown> = {};
  for (const [namespaceId, namespaceNode] of Object.entries(namespaces)) {
    if (isRecord(namespaceNode) && isRecord(namespaceNode['tables'])) {
      const prunedNode = pruneRecord(namespaceNode, 'tables', ownedByOthers);
      if (prunedNode !== namespaceNode) removed = true;
      prunedNamespaces[namespaceId] = prunedNode;
    } else {
      prunedNamespaces[namespaceId] = namespaceNode;
    }
  }
  if (!removed) return schema;
  return { ...schema, namespaces: prunedNamespaces };
}

function pruneRecord(
  schema: Record<string, unknown>,
  field: 'tables',
  ownedByOthers: ReadonlySet<string>,
): unknown {
  const source = blindCast<Record<string, unknown>, 'isRecord narrowed the field above'>(
    schema[field],
  );
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
  return { ...schema, [field]: pruned };
}
