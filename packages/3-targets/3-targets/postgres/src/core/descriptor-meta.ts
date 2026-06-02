import type { CodecTypes } from '../exports/codec-types';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringFieldPresets,
  postgresAuthoringTypes,
} from './authoring';
import { postgresTargetDescriptorMetaRuntime } from './descriptor-meta-runtime';

const postgresTargetDescriptorMetaBase = {
  ...postgresTargetDescriptorMetaRuntime,
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
