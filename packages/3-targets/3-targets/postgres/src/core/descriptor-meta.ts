import type { CodecTypes } from '../exports/codec-types';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringFieldPresets,
  postgresAuthoringTypes,
} from './authoring';

const postgresTargetDescriptorMetaBase = {
  kind: 'target',
  familyId: 'sql',
  targetId: 'postgres',
  id: 'postgres',
  version: '0.0.1',
  capabilities: {},
  defaultNamespaceId: 'public',
  authoring: {
    type: postgresAuthoringTypes,
    field: postgresAuthoringFieldPresets,
    entityTypes: postgresAuthoringEntityTypes,
  },
} as const;

export const postgresTargetDescriptorMeta: typeof postgresTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = postgresTargetDescriptorMetaBase;
