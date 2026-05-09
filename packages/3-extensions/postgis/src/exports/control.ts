import type {
  CodecControlHooks,
  ComponentDatabaseDependencies,
  SqlControlExtensionDescriptor,
} from '@prisma-next/family-sql/control';
import { POSTGIS_GEOMETRY_CODEC_ID } from '../core/constants';
import { postgisPackMeta, postgisQueryOperations } from '../core/descriptor-meta';

const geometryControlPlaneHooks: CodecControlHooks = {
  expandNativeType: ({ nativeType, typeParams }) => {
    const srid = typeParams?.['srid'];
    if (typeof srid === 'number' && Number.isInteger(srid) && srid >= 0) {
      // PostGIS prints the type-modifier list without a space — match it
      // here so the verifier doesn't see `geometry(Geometry, 4326)` (DDL)
      // mismatch `geometry(Geometry,4326)` (introspected).
      return `${nativeType}(Geometry,${srid})`;
    }
    return nativeType;
  },
  // PostGIS has no canonical "identity" geometry; backfilling a non-null
  // column requires the user to supply a valid value, so we don't synthesize
  // one here.
  resolveIdentityValue: () => null,
};

const postgisDatabaseDependencies: ComponentDatabaseDependencies<unknown> = {
  init: [
    {
      id: 'postgres.extension.postgis',
      label: 'Enable PostGIS extension',
      install: [
        {
          id: 'extension.postgis',
          label: 'Enable extension "postgis"',
          summary: 'Ensures the postgis extension is available for geospatial operations',
          operationClass: 'additive',
          target: { id: 'postgres' },
          precheck: [
            {
              description: 'verify extension "postgis" is not already enabled',
              sql: "SELECT NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis')",
            },
          ],
          execute: [
            {
              description: 'create extension "postgis"',
              sql: 'CREATE EXTENSION IF NOT EXISTS postgis',
            },
          ],
          postcheck: [
            {
              description: 'confirm extension "postgis" is enabled',
              sql: "SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis')",
            },
          ],
        },
      ],
    },
  ],
};

const postgisExtensionDescriptor: SqlControlExtensionDescriptor<'postgres'> = {
  ...postgisPackMeta,
  types: {
    ...postgisPackMeta.types,
    codecTypes: {
      ...postgisPackMeta.types.codecTypes,
      controlPlaneHooks: {
        [POSTGIS_GEOMETRY_CODEC_ID]: geometryControlPlaneHooks,
      },
    },
  },
  queryOperations: () => postgisQueryOperations(),
  databaseDependencies: postgisDatabaseDependencies,
  create: () => ({
    familyId: 'sql' as const,
    targetId: 'postgres' as const,
  }),
};

export { postgisExtensionDescriptor };
export default postgisExtensionDescriptor;
