/**
 * Postgres's default schema. `postgresTargetDescriptorMeta.defaultNamespaceId`
 * is this value; a leaf constant so other Postgres-target modules (e.g.
 * `pg.enum` ref resolution in `authoring.ts`) can compare against it without
 * importing `descriptor-meta.ts` and creating a cycle.
 */
export const DEFAULT_NAMESPACE_ID = 'public' as const;
