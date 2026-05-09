import type { ContractSpaceMember } from './types';

/**
 * Project the introspected live schema to the slice claimed by a single
 * contract-space member.
 *
 * Returns the same `schema` value with every top-level table claimed by
 * **other** members of the aggregate removed. Tables not claimed by any
 * member flow through unchanged — the planner / verifier sees them as
 * orphans (extras in strict mode).
 *
 * Used by:
 *
 * - The aggregate planner's **synth strategy**: when synthesising a
 *   plan against a member's contract, the live schema must be projected
 *   to that member's slice so the planner doesn't treat tables claimed
 *   by other members as "extras" and emit destructive ops to drop
 *   them.
 * - The aggregate verifier's **schemaCheck**: projects per member so the
 *   single-contract `verifySqlSchema` only sees the slice claimed by
 *   the member it is checking. Closes the F23 architectural concern
 *   (multi-member deployments where each member's tables look like
 *   extras to every other member's verify pass).
 *
 * **Duck-typing semantics** (preserved from the predecessor
 * `pruneSchemaByOtherSpaceContracts`): the helper operates on `unknown`
 * for the schema and falls through structurally if the shape doesn't
 * match. Every family today exposes `storage.tables: Record<string, ...>`
 * and the introspected schema mirrors the same shape; a future family
 * with a different storage shape gets the schema returned unchanged
 * rather than blowing up the aggregate planner.
 */
export function projectSchemaToSpace(
  schema: unknown,
  member: ContractSpaceMember,
  otherMembers: ReadonlyArray<ContractSpaceMember>,
): unknown {
  if (typeof schema !== 'object' || schema === null) return schema;
  const schemaObj = schema as { readonly tables?: unknown };
  if (typeof schemaObj.tables !== 'object' || schemaObj.tables === null) return schema;
  const schemaTables = schemaObj.tables as Record<string, unknown>;

  const ownedByOthers = new Set<string>();
  for (const other of otherMembers) {
    if (other.spaceId === member.spaceId) continue;
    const storage = (other.contract as { readonly storage?: unknown }).storage;
    if (typeof storage !== 'object' || storage === null) continue;
    const tables = (storage as { readonly tables?: unknown }).tables;
    if (typeof tables !== 'object' || tables === null) continue;
    for (const tableName of Object.keys(tables as Record<string, unknown>)) {
      ownedByOthers.add(tableName);
    }
  }

  if (ownedByOthers.size === 0) return schema;

  const prunedTables: Record<string, unknown> = {};
  for (const [name, table] of Object.entries(schemaTables)) {
    if (!ownedByOthers.has(name)) {
      prunedTables[name] = table;
    }
  }

  return { ...schemaObj, tables: prunedTables };
}
