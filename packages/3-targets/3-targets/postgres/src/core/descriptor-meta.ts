import type { CodecTypes } from '../exports/codec-types';
import {
  postgresAuthoringEntityTypes,
  postgresAuthoringFieldPresets,
  postgresAuthoringPslBlockDescriptors,
  postgresAuthoringTypes,
} from './authoring';
import { postgresQualifyColumnType } from './codecs';
import { postgresTargetDescriptorMetaRuntime } from './descriptor-meta-runtime';
import { DEFAULT_NAMESPACE_ID } from './namespace-ids';
import { postgresCreateNamespace } from './postgres-schema';

const postgresTargetDescriptorMetaBase = {
  ...postgresTargetDescriptorMetaRuntime,
  defaultNamespaceId: DEFAULT_NAMESPACE_ID,
  authoring: {
    type: postgresAuthoringTypes,
    field: postgresAuthoringFieldPresets,
    entityTypes: postgresAuthoringEntityTypes,
    pslBlockDescriptors: postgresAuthoringPslBlockDescriptors,
    createNamespace: postgresCreateNamespace,
    qualifyColumnType: postgresQualifyColumnType,
  },
} as const;

export const postgresTargetDescriptorMeta: typeof postgresTargetDescriptorMetaBase & {
  readonly __codecTypes?: CodecTypes;
} = postgresTargetDescriptorMetaBase;
