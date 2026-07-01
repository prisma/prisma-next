import { elementCoordinates } from '@prisma-next/framework-components/ir';
import type { ContractSpaceMember } from './types';

/**
 * Prunes the introspected live schema down to the slice a single member
 * claims, given the entity names owned by the other members. Family-provided:
 * the framework never touches the storage shape, so only the family knows how
 * to walk its own introspected schema.
 *
 * The returned schema is the same value with every top-level entity owned by
 * another member removed. Entities claimed by no member flow through unchanged,
 * so the per-space verify sees them as orphans (extras in strict mode).
 */
export type ProjectSchemaToMember = (
  schema: unknown,
  ownedByOtherNames: ReadonlySet<string>,
) => unknown;

/**
 * Lists the bare names of every top-level entity in the introspected live
 * schema. Family-provided, for the same reason as {@link ProjectSchemaToMember}:
 * only the family knows how its introspected schema is shaped.
 */
export type ListSchemaEntityNames = (schema: unknown) => readonly string[];

/**
 * The entity names claimed by every member of the aggregate **other than**
 * `member`. Target-agnostic: reads the contract-side storage IR through the
 * framework's {@link elementCoordinates}, never the introspected schema shape.
 */
export function collectOwnedNames(
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
 * Projects the live schema to `member`'s slice by collecting the names owned by
 * the other members ({@link collectOwnedNames}) and handing them to the
 * family-provided {@link ProjectSchemaToMember} callback. When nothing is owned
 * by others, the schema is returned unchanged without invoking the callback.
 */
export function projectSchemaToSpace(
  schema: unknown,
  member: ContractSpaceMember,
  otherMembers: ReadonlyArray<ContractSpaceMember>,
  projectSchemaToMember: ProjectSchemaToMember,
): unknown {
  const ownedByOthers = collectOwnedNames(member, otherMembers);
  if (ownedByOthers.size === 0) return schema;
  return projectSchemaToMember(schema, ownedByOthers);
}
